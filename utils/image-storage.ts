import path from "node:path";
import { readdir, stat, unlink } from "node:fs/promises";
import User from "../models/user.model";
import Post from "../models/post.model";
import Image from "../models/image.model";

const generatedName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg)$/;
export function uploadDirectory() {
  return path.resolve(
    process.env.UPLOAD_DIRECTORY || path.join(process.cwd(), "uploads"),
  );
}
function imagePath(url: string | null | undefined) {
  if (!url) return null;
  const parts = url.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== "" ||
    parts[1] !== "uploads" ||
    !["posts", "profil"].includes(parts[2]) ||
    !generatedName.test(parts[3])
  )
    return null;
  return path.join(uploadDirectory(), parts[2], parts[3]);
}
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
export async function removeImage(url: string | null | undefined) {
  const file = imagePath(url);
  if (!file) return;
  try {
    await Image.deleteOne({ _id: url });
  } catch (error: unknown) {
    console.error(
      "Suppression de photo MongoDB différée jusqu’à la prochaine purge.",
      error,
    );
  }
  try {
    await unlink(file);
  } catch (error: unknown) {
    if (!missing(error))
      console.error(
        "Suppression de photo différée jusqu’à la prochaine purge.",
        error,
      );
  }
}

// La marge protège les images écrites par une requête encore en cours.
export async function purgeOrphanImages(now = Date.now(), graceMs = 3_600_000) {
  const [users, posts] = await Promise.all([
    User.find().select("picture").lean(),
    Post.find().select("picture").lean(),
  ]);
  const referenced = new Set(
    [...users, ...posts]
      .map((record) => record.picture)
      .filter((url): url is string => typeof url === "string"),
  );
  let removed = 0;
  const deleted = await Image.deleteMany({
    _id: { $nin: [...referenced] },
    createdAt: { $lte: new Date(now - graceMs) },
  });
  removed += deleted.deletedCount;
  for (const folder of ["posts", "profil"]) {
    const directory = path.join(uploadDirectory(), folder);
    let files;
    try {
      files = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (missing(error)) continue;
      throw error;
    }
    for (const file of files) {
      if (!file.isFile() || !generatedName.test(file.name)) continue;
      const url = `/uploads/${folder}/${file.name}`;
      if (referenced.has(url)) continue;
      const location = path.join(directory, file.name);
      try {
        if (now - (await stat(location)).mtimeMs < graceMs) continue;
        await unlink(location);
        removed++;
      } catch (error: unknown) {
        if (!missing(error)) throw error;
      }
    }
  }
  return removed;
}
