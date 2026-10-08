import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import Message from "../models/message.model";
import Conversation from "../models/conversation.model";
import { id, text, found, owns, fail } from "../utils/http";
async function membership(conversationId: unknown, userId: unknown) {
  const conversation = found(await Conversation.findById(id(conversationId)));
  if (!conversation.members.includes(String(userId)))
    throw fail(403, "Conversation privée.");
  return conversation;
}
export const postMessage: Handler = async (req, res) => {
  if (req.body.sender) owns(id(req.body.sender), req);
  const conversation = await membership(
    req.body.conversationId,
    currentUser(req)._id,
  );
  const message = await Message.create({
    conversationId: String(conversation._id),
    sender: String(currentUser(req)._id),
    text: text(req.body.text, 2000),
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { updatedAt: new Date() } },
  );
  for (const member of conversation.members) {
    if (member !== String(currentUser(req)._id))
      req.app
        .get("io")
        ?.to(`user:${member}`)
        .emit("getMessage", message.toObject());
  }
  res.status(201).json(message);
};
export const getMessage: Handler = async (req, res) => {
  await membership(req.params.conversationId, currentUser(req)._id);
  res.json(
    await Message.find({ conversationId: req.params.conversationId })
      .sort({ createdAt: 1 })
      .lean(),
  );
};
