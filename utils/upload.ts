import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fail } from "./http";
import { uploadDirectory } from "./image-storage";
import { imageConfiguration } from "../config/runtime";
import Image from "../models/image.model";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500000, files: 1, fields: 8 },
});
async function saveImage(
  file: Express.Multer.File | undefined,
  folder: "posts" | "profil",
  ownerId: string,
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
  const url = `/uploads/${folder}/${name}`;
  const configuration = imageConfiguration();
  if (configuration.IMAGE_STORAGE === "mongo") {
    if (image.length > 500000)
      throw fail(
        413,
        "La photo traitée dépasse 500 Ko. Choisissez une image plus petite.",
      );
    await Image.init();
    for (let attempt = 0; attempt < 8; attempt++) {
      const slots = await Image.find()
        .select("ownerId ownerSlot globalSlot")
        .lean();
      const owned = new Set(
        slots
          .filter((slot) => slot.ownerId === ownerId)
          .map((slot) => slot.ownerSlot),
      );
      const global = new Set(slots.map((slot) => slot.globalSlot));
      const free = (occupied: Set<number>, max: number) => {
        for (let slot = 0; slot < max; slot++)
          if (!occupied.has(slot)) return slot;
        return null;
      };
      const ownerSlot = free(owned, configuration.IMAGE_MAX_PER_USER);
      const globalSlot = free(global, configuration.IMAGE_MAX_TOTAL);
      if (ownerSlot === null)
        throw fail(
          413,
          "Votre quota de photos est atteint. Supprimez une ancienne publication avant d’en ajouter une.",
        );
      if (globalSlot === null)
        throw fail(
          503,
          "Le stockage de photos est plein. Votre saisie est conservée.",
        );
      try {
        await Image.create({
          _id: url,
          ownerId,
          ownerSlot,
          globalSlot,
          contentType: png ? "image/png" : "image/jpeg",
          bytes: image,
        });
        return url;
      } catch (error: unknown) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== 11000
        )
          throw error;
      }
    }
    throw fail(
      409,
      "Plusieurs photos sont enregistrées en même temps. Réessayez votre envoi.",
    );
  }
  const directory = path.join(uploadDirectory(), folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), image, { flag: "wx" });
  return url;
}
export { upload, saveImage };
