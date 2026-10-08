const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const sharp = require("sharp");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
process.env.TOKEN_SECRET = "isolated-production-photo-secret-at-least-32";
process.env.CLIENT_URL = "https://sport.example.test";
process.env.IMAGE_STORAGE = "mongo";
process.env.IMAGE_MAX_PER_USER = "2";
process.env.IMAGE_MAX_TOTAL = "3";
process.env.UPLOAD_DIRECTORY = require("node:fs").mkdtempSync(
  require("node:path").join(require("node:os").tmpdir(), "mongo-photos-"),
);
const Image = require("../models/image.model").default;
const Post = require("../models/post.model").default;
const { createApp } = require("../app");
const { runtimeConfiguration } = require("../config/runtime");
const { purgeOrphanImages } = require("../utils/image-storage");
let database, app, photo, alice, bob, aliceId, bobId;
before(async () => {
  database = await MongoMemoryServer.create();
  process.env.MONGODB_URI = database.getUri();
  await require("../config/db").default();
  app = createApp();
  photo = await sharp({
    create: { width: 3, height: 3, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const account = async (email) => {
    const agent = request.agent(app);
    const response = await agent
      .post("/api/user/register")
      .send({ email, password: "Password123!" })
      .expect(201);
    return [agent, response.body.user];
  };
  [alice, aliceId] = await account("production-alice@example.test");
  [bob, bobId] = await account("production-bob@example.test");
});
after(async () => {
  await mongoose.disconnect();
  await database?.stop();
  await fs.rm(process.env.UPLOAD_DIRECTORY, { recursive: true, force: true });
});
test("production runtime refuses insecure origins and unsafe proxy/port; cookies remain HTTPS-only", async () => {
  const node = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(
      runtimeConfiguration().CLIENT_URL,
      "https://sport.example.test",
    );
    process.env.CLIENT_URL = "http://sport.example.test";
    assert.throws(runtimeConfiguration);
    process.env.CLIENT_URL = "https://sport.example.test";
    process.env.TRUST_PROXY = "true";
    assert.throws(runtimeConfiguration);
    delete process.env.TRUST_PROXY;
    process.env.PORT = "invalid";
    assert.throws(runtimeConfiguration);
    delete process.env.PORT;
    const response = await request(app)
      .post("/api/user/login")
      .set("Origin", process.env.CLIENT_URL)
      .send({
        email: "production-alice@example.test",
        password: "Password123!",
      })
      .expect(200);
    assert.match(response.headers["set-cookie"][0], /HttpOnly/);
    assert.match(response.headers["set-cookie"][0], /Secure/);
    assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
    await request(app)
      .post("/api/user/login")
      .set("Origin", "https://other.example.test")
      .send({})
      .expect(403);
  } finally {
    if (node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = node;
  }
});
test("photos survive connection/app restart without a disk file, then replacement/deletion releases them", async () => {
  const response = await alice
    .post("/api/user/upload")
    .field("userId", aliceId)
    .attach("file", photo, "photo.png")
    .expect(200);
  const url = response.body.picture;
  assert.equal(await Image.countDocuments({ _id: url }), 1);
  assert.deepEqual(await fs.readdir(process.env.UPLOAD_DIRECTORY), []);
  await mongoose.disconnect();
  await request(app).get("/ready").expect(503);
  await request(app).get("/health").expect(200);
  await mongoose.connect(database.getUri());
  const restarted = createApp();
  const downloaded = await request(restarted)
    .get(url)
    .expect(200)
    .expect("Content-Type", /image\/png/);
  assert.ok(downloaded.body.length > 0);
  const newPhoto = await alice
    .post("/api/user/upload")
    .field("userId", aliceId)
    .attach("file", photo, "photo.png")
    .expect(200);
  await request(app).get(url).expect(404);
  await request(app).get(newPhoto.body.picture).expect(200);
  await request(app).get("/ready").expect(200);
  await alice.delete(`/api/user/${aliceId}`).expect(204);
  assert.equal(await Image.countDocuments({ ownerId: aliceId }), 0);
  await request(app).get(newPhoto.body.picture).expect(404);
});
test("concurrent photos respect per-account/global slots; deletion releases quota and retry keeps one post", async () => {
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      bob
        .post("/api/post")
        .field("requestId", randomUUID())
        .attach("file", photo, "post.png"),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 2);
  assert.ok(
    attempts.filter((r) => r.status !== 201).every((r) => r.status === 413),
  );
  assert.equal(await Image.countDocuments({ ownerId: bobId }), 2);
  const third = request.agent(app);
  await third
    .post("/api/user/register")
    .send({ email: "third@example.test", password: "Password123!" })
    .expect(201);
  const key = randomUUID();
  const created = await third
    .post("/api/post")
    .field("requestId", key)
    .attach("file", photo, "post.png")
    .expect(201);
  const replay = await third
    .post("/api/post")
    .field("requestId", key)
    .attach("file", photo, "post.png")
    .expect(200);
  assert.equal(replay.body._id, created.body._id);
  assert.equal(await Image.countDocuments(), 3);
  await third.post("/api/post").attach("file", photo, "post.png").expect(503);
  await third.delete(`/api/post/${created.body._id}`).expect(204);
  await request(app).get(created.body.picture).expect(404);
  await third.post("/api/post").attach("file", photo, "post.png").expect(201);
  assert.equal(await Image.countDocuments(), 3);
});
test("partial persistence failure removes uploaded bytes; sweep preserves referenced/recent images", async () => {
  await Post.deleteMany({});
  await Image.deleteMany({});
  const original = Post.create;
  Post.create = async () => {
    throw new Error("isolated metadata failure");
  };
  try {
    await bob.post("/api/post").attach("file", photo, "post.png").expect(500);
  } finally {
    Post.create = original;
  }
  assert.equal(await Image.countDocuments(), 0);
  const active = await bob
    .post("/api/post")
    .attach("file", photo, "post.png")
    .expect(201);
  const old = `/uploads/posts/${randomUUID()}.png`,
    recent = `/uploads/posts/${randomUUID()}.png`;
  await Image.create({
    _id: old,
    ownerId: bobId,
    ownerSlot: 1,
    globalSlot: 1,
    bytes: photo,
    contentType: "image/png",
    createdAt: new Date(Date.now() - 7200000),
  });
  await Image.create({
    _id: recent,
    ownerId: "another",
    ownerSlot: 0,
    globalSlot: 2,
    bytes: photo,
    contentType: "image/png",
  });
  assert.equal(await purgeOrphanImages(), 1);
  assert.equal(await Image.countDocuments({ _id: old }), 0);
  await request(app).get(active.body.picture).expect(200);
  await request(app).get(recent).expect(200);
});
