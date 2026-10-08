import { z } from "zod";
const identifier = z.string().regex(/^[a-f\d]{24}$/i);
export const memberSchema = z.object({
  _id: identifier,
  pseudo: z.string(),
  picture: z.string().default(""),
  bio: z.string().default(""),
  followers: z.array(identifier),
  following: z.array(identifier),
  createdAt: z.string(),
});
export const userSchema = memberSchema.extend({ email: z.email() });
export const commentSchema = z.object({
  _id: identifier,
  commenterId: identifier,
  commenterPseudo: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export const postSchema = z.object({
  _id: identifier,
  posterId: identifier,
  message: z.string().default(""),
  picture: z.string().default(""),
  likers: z.array(identifier),
  comments: z.array(commentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const conversationSchema = z.object({
  pinned: z.boolean().default(false),
  _id: identifier,
  members: z.array(identifier).length(2),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const messageRequestSchema = z
  .object({
    conversationId: identifier,
    text: z.string().trim().min(1).max(2000),
    requestId: z.uuid().transform((value) => value.toLowerCase()),
    sender: identifier.optional(),
  })
  .strict();
export const messageSchema = z.object({
  requestId: z.uuid().optional(),
  _id: identifier,
  conversationId: identifier,
  sender: identifier,
  text: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;
export type User = z.infer<typeof userSchema>;
export type Post = z.infer<typeof postSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export const sessionSchema = z.object({ user: identifier });
export const savedSchema = z.array(identifier);
