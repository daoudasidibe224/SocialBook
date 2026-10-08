import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    posterId: {
      type: String,
      required: true,
    },
    requestId: { type: String, select: false },
    creationHash: { type: String, select: false },
    deleted: { type: Boolean, default: false, select: false },
    commentOperations: {
      type: [
        {
          key: { type: String, required: true },
          sender: { type: String, required: true },
          hash: { type: String, required: true },
          commentId: { type: String, required: true },
        },
      ],
      default: [],
      select: false,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    picture: {
      type: String,
    },
    likers: {
      type: [String],
      required: true,
    },
    comments: {
      type: [
        {
          commenterId: { type: String, required: true },
          commenterPseudo: { type: String, required: true },
          text: { type: String, required: true, maxlength: 500 },
          timestamp: { type: Number, required: true },
        },
      ],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);
PostSchema.set("toJSON", {
  transform: (_document, value: Record<string, unknown>) => {
    delete value.requestId;
    delete value.creationHash;
    delete value.deleted;
    delete value.commentOperations;
    return value;
  },
});
PostSchema.index(
  { posterId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: "string" } } },
);

export default mongoose.model("post", PostSchema);
