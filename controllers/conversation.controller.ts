import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import Conversation from "../models/conversation.model";
import User from "../models/user.model";
import { id, owns, found, fail } from "../utils/http";
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
  res.status(existing ? 200 : 201).json(conversation);
};
export const getUserConv: Handler = async (req, res) => {
  owns(id(req.params.id), req);
  res.json(
    await Conversation.find({ members: req.params.id })
      .sort({ updatedAt: -1 })
      .lean(),
  );
};
export const getUsersConv: Handler = async (req, res) => {
  const first = id(req.params.firstUserId),
    second = id(req.params.secondUserId);
  if (![first, second].includes(String(currentUser(req)._id)))
    throw fail(403, "Conversation privée.");
  res.json(await Conversation.findOne({ members: { $all: [first, second] } }));
};
