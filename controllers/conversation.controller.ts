import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import Conversation from "../models/conversation.model";
import User from "../models/user.model";
import { id, owns, found, fail } from "../utils/http";
import { z } from "zod";
import mongoose from "mongoose";
import { socketServer } from "../socket";
type PersistedConversation = mongoose.InferSchemaType<
  typeof Conversation.schema
> & { _id: mongoose.Types.ObjectId };
function present(conversation: PersistedConversation, userId: string) {
  return {
    _id: conversation._id,
    members: conversation.members,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    pinned: (conversation.pinnedBy ?? []).includes(userId),
  };
}
export const setPinned: Handler = async (req, res) => {
  const input = z.object({ pinned: z.boolean() }).strict().safeParse(req.body);
  if (!input.success)
    throw fail(400, "Indiquez si cette conversation doit être épinglée.");
  const userId = String(currentUser(req)._id),
    conversation = found(await Conversation.findById(id(req.params.id)));
  if (!conversation.members.includes(userId))
    throw fail(403, "Conversation privée.");
  const updated = found(
    await Conversation.findOneAndUpdate(
      { _id: conversation._id },
      input.data.pinned
        ? { $addToSet: { pinnedBy: userId } }
        : { $pull: { pinnedBy: userId } },
      { returnDocument: "after", timestamps: false },
    ),
  );
  socketServer(req)?.to(`user:${userId}`).emit("conversationsChanged");
  res.json(present(updated, userId));
};
export const newConversation: Handler = async (req, res) => {
  if (req.body.senderId) owns(id(req.body.senderId), req);
  const receiver = id(req.body.receiverId);
  const sender = String(currentUser(req)._id);
  if (sender === receiver) throw fail(400, "Choisissez un autre membre.");
  found(await User.findById(receiver));
  const key = [sender, receiver].sort().join(":");
  const existing = await Conversation.findOne({ key });
  const conversation = await Conversation.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, members: [sender, receiver] } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  res.status(existing ? 200 : 201).json(present(found(conversation), sender));
};
export const getUserConv: Handler = async (req, res) => {
  owns(id(req.params.id), req);
  const conversations = await Conversation.find({ members: req.params.id })
    .sort({ updatedAt: -1 })
    .lean();
  res.json(
    conversations.map((conversation) =>
      present(conversation, String(currentUser(req)._id)),
    ),
  );
};
export const getUsersConv: Handler = async (req, res) => {
  const first = id(req.params.firstUserId),
    second = id(req.params.secondUserId);
  if (![first, second].includes(String(currentUser(req)._id)))
    throw fail(403, "Conversation privée.");
  const conversation = await Conversation.findOne({
    members: { $all: [first, second] },
  });
  res.json(
    conversation ? present(conversation, String(currentUser(req)._id)) : null,
  );
};
