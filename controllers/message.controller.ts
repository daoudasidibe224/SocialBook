import type { Handler } from "../utils/http";
import { currentUser, id, found, owns, fail } from "../utils/http";
import { z } from "zod";
import Message from "../models/message.model";
import Conversation from "../models/conversation.model";
import { messageRequestSchema } from "../shared/contracts";
import type { Message as MessageContract } from "../shared/contracts";
import { socketServer } from "../socket";
async function membership(conversationId: unknown, userId: unknown) {
  const conversation = found(await Conversation.findById(id(conversationId)));
  if (!conversation.members.includes(String(userId)))
    throw fail(403, "Conversation privée.");
  return conversation;
}
const duplicate = z.object({ code: z.literal(11000) });
export const postMessage: Handler = async (req, res) => {
  const parsed = messageRequestSchema.safeParse(req.body);
  if (!parsed.success)
    throw fail(
      400,
      "Le message, la conversation et une clé de requête UUID sont requis.",
    );
  const input = parsed.data;
  if (input.sender) owns(input.sender, req);
  const sender = String(currentUser(req)._id);
  const conversation = await membership(input.conversationId, sender);
  let message;
  let created = false;
  try {
    message = await Message.create({
      conversationId: String(conversation._id),
      sender,
      text: input.text,
      requestId: input.requestId,
    });
    created = true;
  } catch (error) {
    if (!duplicate.safeParse(error).success) throw error;
    message = found(
      await Message.findOne({ sender, requestId: input.requestId }),
    );
    if (
      message.conversationId !== input.conversationId ||
      message.text !== input.text
    )
      throw fail(409, "Cette clé de requête correspond à un autre message.");
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    { $max: { updatedAt: message.createdAt } },
    { timestamps: false },
  );
  {
    const payload: MessageContract = {
      _id: String(message._id),
      conversationId: message.conversationId,
      sender: message.sender,
      text: message.text,
      requestId: input.requestId,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
    socketServer(req)
      ?.to(conversation.members.map((member) => `user:${member}`))
      .emit("getMessage", payload);
  }
  res.status(created ? 201 : 200).json(message);
};
export const getMessage: Handler = async (req, res) => {
  await membership(req.params.conversationId, currentUser(req)._id);
  res.json(
    await Message.find({ conversationId: req.params.conversationId })
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
  );
};
