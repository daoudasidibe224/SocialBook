import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import Post from "../models/post.model";
import { saveImage } from "../utils/upload";
import { id, text, found, owns, fail } from "../utils/http";
export const readPost: Handler = async (req, res) =>
  res.json(await Post.find().sort({ createdAt: -1 }).lean());
export const createPost: Handler = async (req, res) => {
  if (req.body.posterId) owns(id(req.body.posterId), req);
  const message = text(req.body.message, 500, true);
  if (!message && !req.file)
    throw fail(400, "Écrivez un message ou ajoutez une image.");
  const picture = await saveImage(req.file, "posts");
  res
    .status(201)
    .json(
      await Post.create({
        posterId: String(currentUser(req)._id),
        message,
        picture,
        likers: [],
        comments: [],
      }),
    );
};
export const updatePost: Handler = async (req, res) => {
  const post = found(await Post.findById(id(req.params.id)));
  owns(post.posterId, req);
  post.message = text(req.body.message, 500, Boolean(post.picture));
  res.json(await post.save());
};
export const deletePost: Handler = async (req, res) => {
  const post = found(await Post.findById(id(req.params.id)));
  owns(post.posterId, req);
  await post.deleteOne();
  res.status(204).end();
};
const like = async (
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  remove: boolean,
) => {
  const postId = id(req.params.id);
  if (req.body.id) owns(id(req.body.id), req);
  found(await Post.findById(postId));
  const operation = remove ? "$pull" : "$addToSet";
  const post = await Post.findByIdAndUpdate(
    postId,
    { [operation]: { likers: String(currentUser(req)._id) } },
    { returnDocument: "after" },
  );
  res.json(post);
};
export const likePost: Handler = (req, res) => like(req, res, false);
export const unlikePost: Handler = (req, res) => like(req, res, true);
export const commentPost: Handler = async (req, res) => {
  if (req.body.commenterId) owns(id(req.body.commenterId), req);
  const post = found(await Post.findById(id(req.params.id)));
  post.comments.push({
    commenterId: String(currentUser(req)._id),
    commenterPseudo: currentUser(req).pseudo,
    text: text(req.body.text, 500),
    timestamp: Date.now(),
  });
  res.json(await post.save());
};
const commentAction = async (
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  remove: boolean,
) => {
  const post = found(await Post.findById(id(req.params.id)));
  const comment = found(post.comments.id(id(req.body.commentId)));
  owns(comment.commenterId, req);
  if (remove) comment.deleteOne();
  else comment.text = text(req.body.text, 500);
  res.json(await post.save());
};
export const editCommentPost: Handler = (req, res) =>
  commentAction(req, res, false);
export const deleteCommentPost: Handler = (req, res) =>
  commentAction(req, res, true);
