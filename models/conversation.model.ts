import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    members: {
      type: [String],
      required: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model("conversation", ConversationSchema);
