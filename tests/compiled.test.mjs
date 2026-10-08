import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import mongoose from "mongoose";
import request from "supertest";
import sharp from "sharp";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../dist/app.js";
import userModule from "../dist/models/user.model.js";

test("compiled API writes, serves and deletes photos from the configured directory", async () => {
  const directory = await fs.mkdtemp(
    path.join(tmpdir(), "social-compiled-photos-"),
  );
  process.env.UPLOAD_DIRECTORY = directory;
  process.env.TOKEN_SECRET = "compiled-test-secret-of-more-than-32-characters";
  const database = await MongoMemoryServer.create();
  try {
    await mongoose.connect(database.getUri());
    const User = userModule.default;
    await User.init();
    const app = createApp();
    const account = request.agent(app);
    const credentials = {
      pseudo: "compiled",
      email: "compiled@example.test",
      password: "Password123!",
    };
    await account.post("/api/user/register").send(credentials).expect(201);
    const login = await account
      .post("/api/user/login")
      .send(credentials)
      .expect(200);
    const userId = login.body.user;
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const photo = await account
      .post("/api/user/upload")
      .field("userId", userId)
      .attach("file", image, "photo.png")
      .expect(200);
    const stored = path.join(
      directory,
      photo.body.picture.slice("/uploads/".length),
    );
    assert.ok((await fs.stat(stored)).isFile());
    await request(app)
      .get(photo.body.picture)
      .expect(200)
      .expect("Content-Type", /image\/png/);
    await account.delete(`/api/user/${userId}`).expect(204);
    await request(app).get(photo.body.picture).expect(404);
    await assert.rejects(fs.access(stored), { code: "ENOENT" });
  } finally {
    await mongoose.disconnect();
    await database.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
