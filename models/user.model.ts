import mongoose from "mongoose";
import { isEmail } from "validator";
import bcrypt from "bcrypt";

const userSchema = new mongoose.Schema(
  {
    pseudo: {
      type: String,
      required: true,
      minLength: 3,
      maxLength: 55,
      lowercase: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      validate: isEmail,
      lowercase: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      maxlength: 1024,
      minLength: 8,
    },
    picture: {
      type: String,
      default: "/uploads/profil/random-user.png",
    },
    bio: {
      type: String,
      maxlength: 1024,
    },
    followers: {
      type: [String],
    },
    following: {
      type: [String],
    },
  },
  {
    timestamps: true,
  },
);

// avant de faire des 'save' dans la DB exectuter cette fonction pour crypter le mdp,
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt();
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model("user", userSchema);
export async function loginUser(email: string, password: string) {
  const user = await User.findOne({ email });
  return user && (await bcrypt.compare(password, user.password)) ? user : null;
}
export default User;
