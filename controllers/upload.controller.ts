import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import User from "../models/user.model";
import { saveImage } from "../utils/upload";
import { id, owns, fail } from "../utils/http";
export const uploadProfil: Handler = async (req, res) => {
  owns(id(req.body.userId), req);
  if (!req.file) throw fail(400, "Choisissez une image.");
  const picture = await saveImage(req.file, "profil");
  res.json(
    await User.findByIdAndUpdate(
      currentUser(req)._id,
      { $set: { picture } },
      { returnDocument: "after" },
    ).select("-password"),
  );
};
