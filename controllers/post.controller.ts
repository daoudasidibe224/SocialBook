import type { Handler } from "../utils/http";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { currentUser } from "../utils/http";
import Post from "../models/post.model";
import { saveImage } from "../utils/upload";
import { removeImage } from "../utils/image-storage";
import { id, text, found, owns, fail } from "../utils/http";
export const readPost: Handler = async (req, res) =>
  res.json(
    await Post.find({ deleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .lean(),
  );
const activePost = (value: unknown) => ({
  _id: id(value),
  deleted: { $ne: true },
});
function requestKey(value: unknown) {
  if (value === undefined) return undefined;
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw fail(400, "Identifiant de soumission invalide.");
  return parsed.data;
}
const fingerprint = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const createPost: Handler = async (req, res) => {
  if (req.body.posterId) owns(id(req.body.posterId), req);
  const message = text(req.body.message, 500, true);
  if (!message && !req.file)
    throw fail(400, "Écrivez un message ou ajoutez une image.");
  const requestId = requestKey(req.body.requestId);
  const posterId = String(currentUser(req)._id);
  const creationHash = fingerprint(
    JSON.stringify({
      message,
      image: req.file ? fingerprint(req.file.buffer) : null,
    }),
  );
  const replay = async () => {
    if (!requestId) return null;
    const existing = await Post.findOne({ posterId, requestId }).select(
      "+creationHash +deleted",
    );
    if (
      existing &&
      (existing.deleted || existing.creationHash !== creationHash)
    )
      throw fail(
        409,
        "Cette soumission a déjà été utilisée ou supprimée. Ouvrez une nouvelle publication.",
      );
    return existing;
  };
  const existing = await replay();
  if (existing) return res.status(200).json(existing);
  const picture = await saveImage(req.file, "posts");
  try {
    res.status(201).json(
      await Post.create({
        posterId,
        requestId,
        creationHash,
        message,
        picture,
        likers: [],
        comments: [],
      }),
    );
  } catch (error: unknown) {
    await removeImage(picture);
    if (
      requestId &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      const previous = await replay();
      if (previous) return res.status(200).json(previous);
    }
    throw error;
  }
};
export const updatePost: Handler = async (req, res) => {
  const post = found(await Post.findOne(activePost(req.params.id)));
  owns(post.posterId, req);
  const message = text(req.body.message, 500, Boolean(post.picture));
  if (
    req.body.expectedMessage !== undefined &&
    typeof req.body.expectedMessage !== "string"
  )
    throw fail(400, "Texte d’origine invalide.");
  const updated = await Post.findOneAndUpdate(
    {
      ...activePost(req.params.id),
      ...(req.body.expectedMessage !== undefined
        ? { message: req.body.expectedMessage }
        : {}),
    },
    { $set: { message } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated)
    throw fail(
      409,
      "La publication a changé ou a été supprimée. Votre saisie est conservée.",
    );
  res.json(updated);
};
export const deletePost: Handler = async (req, res) => {
  const post = found(await Post.findById(id(req.params.id)));
  owns(post.posterId, req);
  const picture = post.picture;
  await Post.updateOne(
    { _id: post._id },
    {
      $set: {
        deleted: true,
        message: "",
        picture: "",
        likers: [],
        comments: [],
        commentOperations: [],
      },
    },
  );
  await removeImage(picture);
  res.status(204).end();
};
const like = async (
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  remove: boolean,
) => {
  const filter = activePost(req.params.id);
  if (req.body.id) owns(id(req.body.id), req);
  const operation = remove ? "$pull" : "$addToSet";
  const post = found(
    await Post.findOneAndUpdate(
      filter,
      { [operation]: { likers: String(currentUser(req)._id) } },
      { returnDocument: "after" },
    ),
  );
  res.json(post);
};
export const likePost: Handler = (req, res) => like(req, res, false);
export const unlikePost: Handler = (req, res) => like(req, res, true);
export const commentPost: Handler = async (req, res) => {
  if (req.body.commenterId) owns(id(req.body.commenterId), req);
  const sender = String(currentUser(req)._id);
  const value = text(req.body.text, 500);
  const key = requestKey(req.body.requestId);
  const hash = fingerprint(value);
  const post = found(
    await Post.findOne(activePost(req.params.id)).select("+commentOperations"),
  );
  const replay = (previous: typeof post) => {
    const operation = previous.commentOperations.find(
      (item) => item.key === key && item.sender === sender,
    );
    if (!operation) return false;
    if (operation.hash !== hash || !previous.comments.id(operation.commentId))
      throw fail(
        409,
        "Ce commentaire a déjà été modifié ou supprimé. Saisissez un nouveau commentaire.",
      );
    return true;
  };
  if (key && replay(post)) return res.json(post);
  const commentId = new Types.ObjectId();
  const comment = {
    _id: commentId,
    commenterId: sender,
    commenterPseudo: currentUser(req).pseudo,
    text: value,
    timestamp: Date.now(),
  };
  const updated = await Post.findOneAndUpdate(
    {
      ...activePost(req.params.id),
      ...(key
        ? { commentOperations: { $not: { $elemMatch: { key, sender } } } }
        : {}),
    },
    {
      $push: {
        comments: comment,
        ...(key
          ? {
              commentOperations: {
                key,
                sender,
                hash,
                commentId: String(commentId),
              },
            }
          : {}),
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (updated) return res.json(updated);
  const previous = found(
    await Post.findOne(activePost(req.params.id)).select("+commentOperations"),
  );
  if (key && replay(previous)) return res.json(previous);
  throw fail(409, "La publication a changé. Votre commentaire est conservé.");
};
const commentAction = async (
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  remove: boolean,
) => {
  if (
    req.body.expectedText !== undefined &&
    typeof req.body.expectedText !== "string"
  )
    throw fail(400, "Texte d’origine invalide.");
  const post = found(await Post.findOne(activePost(req.params.id)));
  const comment = found(post.comments.id(id(req.body.commentId)));
  owns(comment.commenterId, req);
  const updated = await Post.findOneAndUpdate(
    {
      ...activePost(req.params.id),
      comments: {
        $elemMatch: {
          _id: comment._id,
          commenterId: comment.commenterId,
          ...(req.body.expectedText !== undefined
            ? { text: req.body.expectedText }
            : {}),
        },
      },
    },
    remove
      ? { $pull: { comments: { _id: comment._id } } }
      : { $set: { "comments.$.text": text(req.body.text, 500) } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated)
    throw fail(
      409,
      "Ce commentaire a changé ou a été supprimé. Votre saisie est conservée.",
    );
  res.json(updated);
};
export const editCommentPost: Handler = (req, res) =>
  commentAction(req, res, false);
export const deleteCommentPost: Handler = (req, res) =>
  commentAction(req, res, true);
