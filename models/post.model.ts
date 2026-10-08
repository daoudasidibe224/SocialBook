import mongoose from "mongoose";

const PostSchema = new mongoose.Schema(
  {
    posterId: {
      type: String,
      required: true,
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

export default mongoose.model("post", PostSchema);
