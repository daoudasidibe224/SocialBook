import mongoose from "mongoose";

export interface StoredImage {
  _id: string;
  ownerId: string;
  ownerSlot: number;
  globalSlot: number;
  contentType: "image/png" | "image/jpeg";
  bytes: Buffer;
  createdAt: Date;
}
const schema = new mongoose.Schema<StoredImage>(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true },
    ownerSlot: { type: Number, required: true },
    globalSlot: { type: Number, required: true, unique: true },
    contentType: {
      type: String,
      enum: ["image/png", "image/jpeg"],
      required: true,
    },
    bytes: { type: Buffer, required: true, select: false },
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { versionKey: false },
);
schema.index({ ownerId: 1, ownerSlot: 1 }, { unique: true });
export default mongoose.model<StoredImage>("Image", schema);
