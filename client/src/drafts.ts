import { z } from "zod";
const identifier = z.string().regex(/^[a-f\d]{24}$/i);
export type DraftScope =
  | { kind: "post"; userId: string }
  | { kind: "message"; userId: string; conversationId: string };
const photoSchema = z
  .object({
    name: z.string().min(1).max(512),
    type: z.enum(["image/jpeg", "image/png"]),
    lastModified: z.number().int().nonnegative(),
    content: z
      .string()
      .max(670000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
const common = {
  userId: identifier,
  requestId: z.uuid(),
  version: z.uuid(),
  updatedAt: z.iso.datetime(),
};
export const storedDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("post"),
      text: z.string().max(500),
      photo: photoSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("message"),
      conversationId: identifier,
      text: z.string().max(2000),
    })
    .strict(),
]);
export type StoredDraft = z.infer<typeof storedDraftSchema>;
export interface DraftInput {
  text: string;
  photo: File | null;
  requestId: string;
}
export interface DraftSnapshot extends DraftInput {
  scope: DraftScope;
}
export class DraftConflictError extends Error {
  constructor() {
    super(
      "Un autre onglet a modifié ce brouillon. Votre saisie est conservée. Choisissez la version à garder.",
    );
  }
}
export class DraftStorageError extends Error {
  constructor() {
    super(
      "La sauvegarde du brouillon sur cet appareil est indisponible. Votre saisie reste en mémoire.",
    );
  }
}
export function draftKey(scope: DraftScope) {
  return `community-sportive-draft:${scope.userId}:${scope.kind}${scope.kind === "message" ? ":" + scope.conversationId : ""}`;
}
function read(scope: DraftScope): StoredDraft | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(draftKey(scope));
  } catch {
    throw new DraftStorageError();
  }
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "Le brouillon sauvegardé est invalide. Votre nouvelle saisie sera conservée en mémoire.",
    );
  }
  const parsed = storedDraftSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.userId !== scope.userId ||
    parsed.data.kind !== scope.kind ||
    (parsed.data.kind === "message" &&
      (scope.kind !== "message" ||
        parsed.data.conversationId !== scope.conversationId))
  )
    throw new Error(
      "Le brouillon sauvegardé est invalide. Votre nouvelle saisie sera conservée en mémoire.",
    );
  if (Date.now() - new Date(parsed.data.updatedAt).getTime() > 30 * 86400000) {
    window.localStorage.removeItem(draftKey(scope));
    return null;
  }
  return parsed.data;
}
export function readDraft(scope: DraftScope) {
  return read(scope);
}
const encodings = new WeakMap<File, Promise<z.infer<typeof photoSchema>>>();
async function encodePhoto(photo: File) {
  let pending = encodings.get(photo);
  if (!pending) {
    pending = (async () => {
      const bytes = new Uint8Array(await photo.arrayBuffer());
      if (bytes.byteLength > 500000)
        throw new Error("La photo dépasse 500 Ko.");
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 16384)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 16384),
        );
      return photoSchema.parse({
        name: photo.name,
        type: photo.type,
        lastModified: photo.lastModified,
        content: btoa(binary),
      });
    })();
    encodings.set(photo, pending);
  }
  return pending;
}
export function restoreDraft(record: StoredDraft): DraftSnapshot {
  const scope: DraftScope =
    record.kind === "post"
      ? { kind: "post", userId: record.userId }
      : {
          kind: "message",
          userId: record.userId,
          conversationId: record.conversationId,
        };
  let photo: File | null = null;
  if (record.kind === "post" && record.photo) {
    const binary = atob(record.photo.content);
    if (binary.length > 500000 || binary.length === 0)
      throw new Error("La photo du brouillon est invalide.");
    photo = new File(
      [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
      record.photo.name,
      { type: record.photo.type, lastModified: record.photo.lastModified },
    );
  }
  return { scope, text: record.text, photo, requestId: record.requestId };
}
async function exclusive<T>(
  scope: DraftScope,
  operation: () => T | Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(draftKey(scope), operation);
  return operation();
}
export async function saveDraft(
  snapshot: DraftSnapshot,
  expectedVersion: string | null,
): Promise<StoredDraft> {
  const photo =
    snapshot.scope.kind === "post" && snapshot.photo
      ? await encodePhoto(snapshot.photo)
      : null;
  return exclusive(snapshot.scope, () => {
    let current: StoredDraft | null;
    try {
      current = read(snapshot.scope);
    } catch {
      throw new DraftStorageError();
    }
    if ((current?.version ?? null) !== expectedVersion)
      throw new DraftConflictError();
    if (current?.requestId === snapshot.requestId) return current;
    const metadata = {
      userId: snapshot.scope.userId,
      requestId: snapshot.requestId,
      version: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const payload = storedDraftSchema.parse(
      snapshot.scope.kind === "post"
        ? { ...metadata, kind: "post", text: snapshot.text, photo }
        : {
            ...metadata,
            kind: "message",
            conversationId: snapshot.scope.conversationId,
            text: snapshot.text,
          },
    );
    try {
      window.localStorage.setItem(
        draftKey(snapshot.scope),
        JSON.stringify(payload),
      );
    } catch {
      throw new DraftStorageError();
    }
    return payload;
  });
}
export async function clearDraft(
  scope: DraftScope,
  requestId: string,
): Promise<boolean> {
  return exclusive(scope, () => {
    try {
      const current = read(scope);
      if (current && current.requestId !== requestId) return false;
      window.localStorage.removeItem(draftKey(scope));
      return true;
    } catch {
      throw new DraftStorageError();
    }
  });
}

export async function clearDraftVersion(
  scope: DraftScope,
  expectedVersion: string | null,
): Promise<boolean> {
  return exclusive(scope, () => {
    try {
      const current = read(scope);
      if ((current?.version ?? null) !== expectedVersion) return false;
      window.localStorage.removeItem(draftKey(scope));
      return true;
    } catch {
      throw new DraftStorageError();
    }
  });
}
