import type { Handler } from "../utils/http";
import { currentUser } from "../utils/http";
import User from "../models/user.model";
import { saveImage } from "../utils/upload";
import { id, owns, fail, found } from "../utils/http";
import { removeImage } from "../utils/image-storage";
export const uploadProfil: Handler = async (req, res) => {
  owns(id(req.body.userId), req);
  if (!req.file) throw fail(400, "Choisissez une image.");
  const picture = await saveImage(
    req.file,
    "profil",
    String(currentUser(req)._id),
  );
  let previous;
  try {
    previous = found(
      await User.findByIdAndUpdate(
        currentUser(req)._id,
        { $set: { picture } },
        { returnDocument: "before" },
      ).select("-password"),
    );
  } catch (error: unknown) {
    await removeImage(picture);
    throw error;
  }
  await removeImage(previous.picture);
  res.json(
    found(await User.findById(currentUser(req)._id).select("-password")),
  );
};
