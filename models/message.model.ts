import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: true,
    },
    sender: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 2000,
      trim: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model("message", MessageSchema);
