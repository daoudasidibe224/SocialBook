const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { act, create } = require("react-test-renderer");
const { usePersistentDraft } = require("../client/src/usePersistentDraft.ts");
const { draftKey, readDraft, saveDraft } = require("../client/src/drafts.ts");

const scope = {
  kind: "message",
  userId: "a".repeat(24),
  conversationId: "b".repeat(24),
};

async function mountDraft(t, initialScope = scope) {
  const originalWindow = global.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    global,
    "navigator",
  );
  const originalAct = global.IS_REACT_ACT_ENVIRONMENT;
  const values = new Map();
  const events = new EventTarget();
  let releaseRemoval;
  let removalStarted;
  let removalGate;
  let lockQueue = Promise.resolve();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  global.window = {
    localStorage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: (_key, operation) => {
          const next = lockQueue.then(async () => {
            const result = await operation();
            if (removalGate && !values.has(draftKey(scope))) {
              removalStarted();
              await removalGate;
              removalGate = null;
            }
            return result;
          });
          lockQueue = next.catch(() => {});
          return next;
        },
      },
    },
  });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let draft, renderer;
  function Consumer({ currentScope }) {
    draft = usePersistentDraft(currentScope);
    return null;
  }
  await act(async () => {
    renderer = create(
      React.createElement(Consumer, { currentScope: initialScope }),
    );
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    t.mock.timers.reset();
    global.window = originalWindow;
    if (originalNavigator)
      Object.defineProperty(global, "navigator", originalNavigator);
    else delete global.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = originalAct;
  });
  return {
    get draft() {
      return draft;
    },
    localStorage,
    async settle() {
      await act(async () => {
        await lockQueue;
        await new Promise((resolve) => setImmediate(resolve));
      });
    },
    async tick() {
      await act(async () => {
        t.mock.timers.tick(200);
        await new Promise((resolve) => setImmediate(resolve));
      });
    },
    holdRemoval() {
      removalGate = new Promise((resolve) => {
        releaseRemoval = resolve;
      });
      const started = new Promise((resolve) => {
        removalStarted = resolve;
      });
      return { started, release: () => releaseRemoval() };
    },
    async changeScope(currentScope) {
      await act(async () =>
        renderer.update(React.createElement(Consumer, { currentScope })),
      );
    },
    async storageChanged(changedScope) {
      await act(async () => {
        const event = new Event("storage");
        event.key = draftKey(changedScope);
        events.dispatchEvent(event);
      });
    },
  };
}

test("successful send cancels a pending autosave without a false conflict or restored sent text", async (t) => {
  const hook = await mountDraft(t);
  await act(async () =>
    hook.draft.setText("Vérification navigateur terminée."),
  );
  let snapshot;
  await act(async () => {
    snapshot = await hook.draft.prepare();
  });
  const removal = hook.holdRemoval();
  let acknowledgment;
  await act(async () => {
    acknowledgment = hook.draft.acknowledge(snapshot);
    await removal.started;
  });
  // The debounce expires while the successful send still holds the storage lock.
  await hook.tick();
  await act(async () => {
    removal.release();
    await acknowledgment;
  });
  await hook.settle();
  assert.equal(hook.draft.text, "");
  assert.equal(hook.draft.conflict, false);
  assert.equal(hook.draft.notice, "");
  assert.equal(readDraft(scope), null);
});

test("another tab's version is preserved and produces a real conflict", async (t) => {
  const hook = await mountDraft(t);
  await act(async () => hook.draft.setText("Ma saisie privée"));
  await hook.tick();
  const current = readDraft(scope);
  await saveDraft(
    {
      scope,
      text: "Autre onglet",
      photo: null,
      requestId: crypto.randomUUID(),
    },
    current.version,
  );
  await hook.storageChanged(scope);
  assert.equal(hook.draft.text, "Ma saisie privée");
  assert.equal(hook.draft.conflict, true);
  await act(async () => hook.draft.keepCurrent());
  assert.equal(hook.draft.conflict, false);
  assert.equal(readDraft(scope).text, "Ma saisie privée");
});

test("an edit during acknowledgment is saved after the sent version is removed", async (t) => {
  const hook = await mountDraft(t);
  await act(async () => hook.draft.setText("Message envoyé"));
  let snapshot;
  await act(async () => {
    snapshot = await hook.draft.prepare();
  });
  const removal = hook.holdRemoval();
  let acknowledgment;
  await act(async () => {
    acknowledgment = hook.draft.acknowledge(snapshot);
    await removal.started;
  });
  await act(async () => hook.draft.setText("Message suivant"));
  await hook.tick();
  await act(async () => {
    removal.release();
    await acknowledgment;
  });
  await hook.settle();
  assert.equal(hook.draft.text, "Message suivant");
  assert.equal(hook.draft.conflict, false);
  assert.equal(readDraft(scope).text, "Message suivant");
});

test("a failed send keeps its text and request identifier for retry", async (t) => {
  const hook = await mountDraft(t);
  await act(async () => hook.draft.setText("Message à réessayer"));
  let first, retry;
  await act(async () => {
    first = await hook.draft.prepare();
  });
  await hook.tick();
  await act(async () => {
    retry = await hook.draft.prepare();
  });
  assert.equal(retry.requestId, first.requestId);
  assert.equal(hook.draft.text, first.text);
  assert.equal(readDraft(scope).requestId, first.requestId);
});

test("late acknowledgment preserves a different conversation's private draft", async (t) => {
  const hook = await mountDraft(t);
  await act(async () => hook.draft.setText("Message envoyé"));
  let snapshot;
  await act(async () => {
    snapshot = await hook.draft.prepare();
  });
  const otherScope = { ...scope, conversationId: "c".repeat(24) };
  await hook.changeScope(otherScope);
  await act(async () =>
    hook.draft.setText("Brouillon de l’autre conversation"),
  );
  await hook.tick();
  await act(async () => hook.draft.acknowledge(snapshot));
  assert.equal(readDraft(scope), null);
  assert.equal(readDraft(otherScope).text, "Brouillon de l’autre conversation");
  assert.equal(hook.draft.text, "Brouillon de l’autre conversation");
  assert.equal(hook.draft.conflict, false);
});
