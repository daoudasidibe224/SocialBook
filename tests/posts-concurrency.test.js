const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
process.env.TOKEN_SECRET = "post-concurrency-isolated-secret-32-characters";
process.env.CLIENT_URL = "http://127.0.0.1:4313";
const directory = require("node:fs").mkdtempSync(
  path.join(require("node:os").tmpdir(), "social-post-concurrency-"),
);
process.env.UPLOAD_DIRECTORY = directory;
const app = require("../app").default;
const Post = require("../models/post.model").default;
let db, account, userId;
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([
    Post.init(),
    require("../models/user.model").default.init(),
  ]);
  account = request.agent(app);
  const credentials = {
    pseudo: "Concurrence",
    email: "concurrence@example.test",
    password: "Password123!",
  };
  await account.post("/api/user/register").send(credentials).expect(201);
  userId = (await account.post("/api/user/login").send(credentials).expect(200))
    .body.user;
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
  await fs.rm(directory, { recursive: true, force: true });
});
async function create(message = "Séance du jour") {
  return (
    await account
      .post("/api/post")
      .send({ message, requestId: randomUUID() })
      .expect(201)
  ).body;
}
test("deux publications simultanées gardent une seule photo et le même identifiant", async () => {
  const requestId = randomUUID();
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const send = () =>
    account
      .post("/api/post")
      .field("message", "Séance en image")
      .field("requestId", requestId)
      .attach("file", image, {
        filename: "seance.png",
        contentType: "image/png",
      });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map((result) => result.status).sort(), [200, 201]);
  assert.equal(responses[0].body._id, responses[1].body._id);
  assert.equal(await Post.countDocuments({ posterId: userId, requestId }), 1);
  assert.equal((await fs.readdir(path.join(directory, "posts"))).length, 1);
  assert.equal(responses[0].body.creationHash, undefined);
  assert.equal(responses[0].body.requestId, undefined);
});
test("une soumission modifiée ou supprimée ne peut pas recréer la publication", async () => {
  const requestId = randomUUID();
  const post = (
    await account
      .post("/api/post")
      .send({ message: "À supprimer", requestId })
      .expect(201)
  ).body;
  await account
    .post("/api/post")
    .send({ message: "Autre texte", requestId })
    .expect(409);
  await account.delete(`/api/post/${post._id}`).expect(204);
  await account.delete(`/api/post/${post._id}`).expect(204);
  await account
    .post("/api/post")
    .send({ message: "À supprimer", requestId })
    .expect(409);
  const feed = (await account.get("/api/post").expect(200)).body;
  assert.ok(!feed.some((item) => item._id === post._id));
  const tombstone = await Post.findById(post._id).select("+deleted");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.message, "");
  assert.equal(tombstone.picture, "");
  assert.equal(tombstone.comments.length, 0);
});
test("deux éditions concurrentes signalent un conflit sans perdre la gagnante", async () => {
  const post = await create("Version d’origine");
  const results = await Promise.all(
    ["Version A", "Version B"].map((message) =>
      account
        .put(`/api/post/${post._id}`)
        .send({ message, expectedMessage: "Version d’origine" }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200).body;
  assert.equal((await Post.findById(post._id)).message, winner.message);
});
test("un commentaire répété est unique et une nouvelle intention peut reprendre le même texte", async () => {
  const post = await create();
  const requestId = randomUUID();
  const send = (key) =>
    account
      .patch(`/api/post/comment-post/${post._id}`)
      .send({ text: "Bravo", requestId: key });
  const results = await Promise.all([send(requestId), send(requestId)]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal((await Post.findById(post._id)).comments.length, 1);
  await send(randomUUID()).expect(200);
  assert.equal((await Post.findById(post._id)).comments.length, 2);
  await account
    .patch(`/api/post/comment-post/${post._id}`)
    .send({ text: "Autre texte", requestId })
    .expect(409);
});
test("deux commentaires distincts se conservent et un commentaire supprimé ne renaît pas", async () => {
  const post = await create();
  const keys = [randomUUID(), randomUUID()];
  await Promise.all(
    keys.map((requestId, index) =>
      account
        .patch(`/api/post/comment-post/${post._id}`)
        .send({ text: `Commentaire ${index}`, requestId })
        .expect(200),
    ),
  );
  const saved = await Post.findById(post._id);
  assert.equal(saved.comments.length, 2);
  const comment = saved.comments.find((item) => item.text === "Commentaire 0");
  await account
    .patch(`/api/post/delete-comment-post/${post._id}`)
    .send({ commentId: String(comment._id) })
    .expect(200);
  await account
    .patch(`/api/post/comment-post/${post._id}`)
    .send({ text: "Commentaire 0", requestId: keys[0] })
    .expect(409);
  assert.equal((await Post.findById(post._id)).comments.length, 1);
});
test("les éditions de commentaire sont atomiques et les j’aime répétés restent uniques", async () => {
  const post = await create();
  const comment = (
    await account
      .patch(`/api/post/comment-post/${post._id}`)
      .send({ text: "Original", requestId: randomUUID() })
      .expect(200)
  ).body.comments[0];
  const edits = await Promise.all(
    ["A", "B"].map((text) =>
      account
        .patch(`/api/post/edit-comment-post/${post._id}`)
        .send({ commentId: comment._id, text, expectedText: "Original" }),
    ),
  );
  assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      account.patch(`/api/post/like-post/${post._id}`).send({}).expect(200),
    ),
  );
  assert.deepEqual((await Post.findById(post._id)).likers, [userId]);
  await account.delete(`/api/post/${post._id}`).expect(204);
  await account.patch(`/api/post/like-post/${post._id}`).send({}).expect(404);
  await account
    .patch(`/api/post/comment-post/${post._id}`)
    .send({ text: "Tardif", requestId: randomUUID() })
    .expect(404);
});
test("les clés invalides sont refusées avant écriture", async () => {
  await account
    .post("/api/post")
    .send({ message: "Invalide", requestId: "x" })
    .expect(400);
  const post = await create();
  await account
    .patch(`/api/post/comment-post/${post._id}`)
    .send({ text: "Invalide", requestId: {} })
    .expect(400);
  assert.equal((await Post.findById(post._id)).comments.length, 0);
});
