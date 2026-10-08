import type { Message } from "../../shared/contracts";
export function mergeMessages(
  existing: Message[],
  incoming: Message[],
): Message[] {
  const byId = new Map(existing.map((message) => [message._id, message]));
  for (const message of incoming) byId.set(message._id, message);
  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id),
  );
}
