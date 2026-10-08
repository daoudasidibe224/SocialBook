import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import User from "../models/user.model";
import Post from "../models/post.model";
import Message from "../models/message.model";
import Conversation from "../models/conversation.model";
import { id, text, found, owns, fail } from "../utils/http";
const publicFields = "_id pseudo picture bio followers following createdAt";
export const getAllUsers: Handler = async (req, res) =>
  res.json(await User.find().select(publicFields).lean());
export const userInfo: Handler = async (req, res) => {
  const fields =
    String(currentUser(req)._id) === req.params.id ? "-password" : publicFields;
  res.json(found(await User.findById(id(req.params.id)).select(fields).lean()));
};
export const updateUser: Handler = async (req, res) => {
  owns(id(req.params.id), req);
  res.json(
    found(
      await User.findByIdAndUpdate(
        req.params.id,
        { $set: { bio: text(req.body.bio, 1024, true) } },
        { returnDocument: "after", runValidators: true },
      ).select("-password"),
    ),
  );
};
export const deleteUser: Handler = async (req, res) => {
  owns(id(req.params.id), req);
  const userId = String(currentUser(req)._id);
  const conversations = await Conversation.find({ members: userId });
  await Message.deleteMany({
    conversationId: { $in: conversations.map((c) => String(c._id)) },
  });
  await Conversation.deleteMany({ members: userId });
  await Post.deleteMany({ posterId: userId });
  await Post.updateMany(
    {},
    { $pull: { likers: userId, comments: { commenterId: userId } } },
  );
  await User.updateMany(
    {},
    { $pull: { followers: userId, following: userId } },
  );
  await User.deleteOne({ _id: userId });
  res.clearCookie("jwt", { path: "/" });
  res.status(204).end();
};
const changeFollowing = async (
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  remove: boolean,
) => {
  owns(id(req.params.id), req);
  const targetId = id(remove ? req.body.idToUnfollow : req.body.idToFollow);
  if (targetId === req.params.id)
    throw fail(400, "Vous ne pouvez pas vous suivre vous-même.");
  found(await User.findById(targetId));
  const operation = remove ? "$pull" : "$addToSet";
  await User.findByIdAndUpdate(targetId, {
    [operation]: { followers: req.params.id },
  });
  res.json(
    await User.findByIdAndUpdate(
      req.params.id,
      { [operation]: { following: targetId } },
      { returnDocument: "after" },
    ).select("-password"),
  );
};
export const follow: Handler = (req, res) => changeFollowing(req, res, false);
export const unfollow: Handler = (req, res) => changeFollowing(req, res, true);
export const getFollowings: Handler = async (req, res) => {
  const user = found(await User.findById(id(req.params.id)));
  res.json(
    await User.find({ _id: { $in: user.following } })
      .select(publicFields)
      .lean(),
  );
};
