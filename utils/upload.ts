import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail } from "./http";
import { uploadDirectory } from "./image-storage";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500000, files: 1, fields: 8 },
});
async function saveImage(
  file: Express.Multer.File | undefined,
  folder: "posts" | "profil",
) {
  if (!file) return "";
  const png = file.buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    file.buffer[0] === 255 &&
    file.buffer[1] === 216 &&
    file.buffer[2] === 255 &&
    file.buffer[file.buffer.length - 2] === 255 &&
    file.buffer[file.buffer.length - 1] === 217;
  if (
    (!png && !jpeg) ||
    (png && file.mimetype !== "image/png") ||
    (jpeg && !["image/jpeg", "image/jpg"].includes(file.mimetype))
  )
    throw fail(400, "Choisissez une image JPEG ou PNG valide.");
  let image: Buffer;
  try {
    image = await sharp(file.buffer, { limitInputPixels: 16000000 })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();
  } catch {
    throw fail(
      400,
      "Cette image est illisible ou dépasse 16 millions de pixels.",
    );
  }
  const name = `${randomUUID()}.${png ? "png" : "jpg"}`;
  const directory = path.join(uploadDirectory(), folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), image, { flag: "wx" });
  return `/uploads/${folder}/${name}`;
}
export { upload, saveImage };
