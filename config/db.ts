import mongoose from "mongoose";
import User from "../models/user.model";
import Post from "../models/post.model";
import Conversation from "../models/conversation.model";
import Message from "../models/message.model";
export default async function connect() {
  await mongoose.connect(process.env.MONGODB_URI || "", {
    serverSelectionTimeoutMS: 10000,
  });
  await Promise.all([
    User.init(),
    Post.init(),
    Conversation.init(),
    Message.init(),
  ]);
}
