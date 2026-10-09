import { useEffect, useRef, useState } from "react";
import {
  clearDraft,
  clearDraftVersion,
  draftKey,
  DraftConflictError,
  DraftStorageError,
  readDraft,
  restoreDraft,
  saveDraft,
  type DraftScope,
  type DraftSnapshot,
  type StoredDraft,
} from "./drafts";
interface DraftState {
  scope: DraftScope | null;
  text: string;
  photo: File | null;
  requestId: string;
}
const fresh = (scope: DraftScope | null): DraftState => ({
  scope,
  text: "",
  photo: null,
  requestId: crypto.randomUUID(),
});
const keyOf = (scope: DraftScope | null) => (scope ? draftKey(scope) : "");
export function usePersistentDraft(scope: DraftScope | null) {
  const key = keyOf(scope),
    [state, setState] = useState<DraftState>(() => fresh(null)),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState(false);
  const dirty = useRef(false);
  const live = useRef(state),
    versions = useRef(new Map<string, string | null>()),
    queue = useRef<Promise<void>>(Promise.resolve());
  function adopt(next: DraftState) {
    live.current = next;
    setState(next);
  }
  function reload() {
    dirty.current = false;
    if (!scope) {
      adopt(fresh(null));
      return;
    }
    try {
      const stored = readDraft(scope);
      versions.current.set(key, stored?.version ?? null);
      adopt(stored ? restoreDraft(stored) : fresh(scope));
      setNotice(stored ? "Votre brouillon a été récupéré." : "");
      setConflict(false);
    } catch (error) {
      versions.current.set(key, null);
      adopt(fresh(scope));
      setNotice(
        error instanceof Error
          ? error.message
          : "Le brouillon n’a pas pu être chargé.",
      );
    }
  }
  useEffect(() => {
    reload();
  }, [key]);
  function edit(changes: Partial<Pick<DraftState, "text" | "photo">>) {
    const current =
      keyOf(live.current.scope) === key ? live.current : fresh(scope);
    dirty.current = true;
    adopt({ ...current, ...changes, requestId: crypto.randomUUID() });
  }
  async function persist(snapshot: DraftSnapshot): Promise<StoredDraft> {
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        const saved = await saveDraft(
          snapshot,
          versions.current.get(draftKey(snapshot.scope)) ?? null,
        );
        versions.current.set(draftKey(snapshot.scope), saved.version);
        if (
          live.current.requestId === snapshot.requestId &&
          keyOf(live.current.scope) === draftKey(snapshot.scope)
        ) {
          dirty.current = false;
          setNotice("Brouillon enregistré sur cet appareil.");
        }
        return saved;
      });
    queue.current = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  function report(error: unknown) {
    if (keyOf(live.current.scope) !== key) return;
    setConflict(error instanceof DraftConflictError);
    setNotice(
      error instanceof Error
        ? error.message
        : "Le brouillon n’a pas pu être sauvegardé.",
    );
  }
  function flush(snapshot: DraftSnapshot): Promise<void> {
    if (snapshot.text || snapshot.photo)
      return persist(snapshot).then(() => {});
    const operation = queue.current.then(async () => {
      const snapshotKey = draftKey(snapshot.scope);
      const cleared = await clearDraftVersion(
        snapshot.scope,
        versions.current.get(snapshotKey) ?? null,
      );
      if (!cleared) throw new DraftConflictError();
      versions.current.set(snapshotKey, null);
      if (live.current.requestId === snapshot.requestId) dirty.current = false;
    });
    queue.current = operation.catch(() => {});
    return operation;
  }
  useEffect(() => {
    if (!state.scope || keyOf(state.scope) !== key || !dirty.current) return;
    const snapshot: DraftSnapshot = { ...state, scope: state.scope };
    const timer = setTimeout(() => {
      if (
        !dirty.current ||
        live.current.requestId !== snapshot.requestId ||
        keyOf(live.current.scope) !== draftKey(snapshot.scope)
      )
        return;
      void flush(snapshot).catch(report);
    }, 200);
    return () => {
      clearTimeout(timer);
      if (
        dirty.current &&
        live.current.requestId === snapshot.requestId &&
        keyOf(live.current.scope) === draftKey(snapshot.scope)
      )
        void flush(snapshot).catch(report);
    };
  }, [state, key]);
  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key === key && scope) {
        try {
          const current = readDraft(scope);
          if (current?.requestId === live.current.requestId) {
            versions.current.set(key, current.version);
            return;
          }
        } catch (error) {
          report(error);
          return;
        }
        if (!live.current.text && !live.current.photo) {
          reload();
          return;
        }
        setConflict(true);
        setNotice(
          "Un autre onglet a modifié ce brouillon. Votre saisie est conservée. Choisissez la version à garder.",
        );
      }
    }
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  async function prepare(): Promise<DraftSnapshot> {
    const current = live.current;
    if (!current.scope || keyOf(current.scope) !== key)
      throw new Error("Le brouillon est en cours de chargement.");
    const snapshot: DraftSnapshot = { ...current, scope: current.scope };
    try {
      await persist(snapshot);
      setConflict(false);
    } catch (error) {
      report(error);
      if (!(error instanceof DraftStorageError)) throw error;
    }
    return snapshot;
  }
  async function acknowledge(snapshot: DraftSnapshot) {
    const sentKey = draftKey(snapshot.scope);
    const operation = queue.current.then(async () => {
      const cleared = await clearDraft(snapshot.scope, snapshot.requestId);
      if (cleared) versions.current.set(sentKey, null);
    });
    queue.current = operation.catch(() => {});
    try {
      await operation;
    } catch (error) {
      report(error);
    }
    if (
      keyOf(live.current.scope) === sentKey &&
      live.current.requestId === snapshot.requestId
    ) {
      dirty.current = false;
      adopt(fresh(snapshot.scope));
      setNotice((current) => (current.includes("indisponible") ? current : ""));
      setConflict(false);
    }
  }
  async function keepCurrent() {
    if (!scope) return;
    try {
      const current = readDraft(scope);
      versions.current.set(key, current?.version ?? null);
      const value = live.current;
      if (!value.scope) return;
      await persist({ ...value, scope: value.scope });
      setNotice("Votre version du brouillon est sauvegardée.");
      setConflict(false);
    } catch (error) {
      report(error);
    }
  }
  async function discard() {
    const current = live.current;
    if (!current.scope) return;
    try {
      await queue.current;
      if (
        keyOf(live.current.scope) === draftKey(current.scope) &&
        live.current.requestId !== current.requestId
      )
        return;
      if (
        !(await clearDraftVersion(
          current.scope,
          versions.current.get(key) ?? null,
        ))
      )
        throw new DraftConflictError();
      versions.current.set(draftKey(current.scope), null);
      if (
        keyOf(live.current.scope) === draftKey(current.scope) &&
        live.current.requestId === current.requestId
      ) {
        dirty.current = false;
        adopt(fresh(current.scope));
        setNotice("");
        setConflict(false);
      }
    } catch (error) {
      report(error);
    }
  }
  return {
    text: keyOf(state.scope) === key ? state.text : "",
    photo: keyOf(state.scope) === key ? state.photo : null,
    ready: keyOf(state.scope) === key,
    notice,
    conflict,
    setText: (text: string) => edit({ text }),
    setPhoto: (photo: File | null) => edit({ photo }),
    prepare,
    acknowledge,
    reload,
    keepCurrent,
    discard,
  };
}
