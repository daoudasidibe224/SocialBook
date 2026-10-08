import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
const schema = new mongoose.Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    userId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);
export default mongoose.model("session", schema);
