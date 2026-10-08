import { z } from "zod";

const origin = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) {
    ctx.addIssue({
      code: "custom",
      message: "Utilisez une origine HTTP(S) sans chemin ni slash final.",
    });
    return z.NEVER;
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "CLIENT_URL doit utiliser HTTPS en production.",
    });
    return z.NEVER;
  }
  return value;
});
export function runtimeConfiguration() {
  return z
    .object({
      PORT: z.coerce.number().int().min(1).max(65535).default(5000),
      HOST: z.string().min(1).default("0.0.0.0"),
      CLIENT_URL: origin,
      MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
      TOKEN_SECRET: z.string().min(32),
      TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    })
    .parse(process.env);
}
export function imageConfiguration() {
  return z
    .object({
      IMAGE_STORAGE: z
        .enum(["filesystem", "mongo"])
        .default(
          process.env.NODE_ENV === "production" ? "mongo" : "filesystem",
        ),
      IMAGE_MAX_PER_USER: z.coerce.number().int().min(1).max(200).default(20),
      IMAGE_MAX_TOTAL: z.coerce.number().int().min(1).max(10000).default(200),
    })
    .parse(process.env);
}
