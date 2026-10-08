const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const { io: client } = require("socket.io-client");
const { once } = require("node:events");
process.env.TOKEN_SECRET = "test-secret-used-only-for-isolated-tests-123456";
process.env.CLIENT_URL = "http://127.0.0.1:4313";
const app = require("../app").default;
let db,
  alice,
  bob,
  eve,
  aliceId,
  bobId,
  eveId,
  postId,
  commentId,
  conversationId,
  server,
  sockets;
const credentials = (name) => ({
  pseudo: name,
  email: `${name}@example.test`,
  password: "Password123!",
});
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([
    require("../models/user.model").default.init(),
    require("../models/conversation.model").default.init(),
  ]);
  alice = request.agent(app);
  bob = request.agent(app);
  eve = request.agent(app);
  for (const [agent, name] of [
    [alice, "alice"],
    [bob, "bob"],
    [eve, "eve"],
  ]) {
    await agent.post("/api/user/register").send(credentials(name)).expect(201);
    const response = await agent
      .post("/api/user/login")
      .send(credentials(name))
      .expect(200);
    if (name === "alice") aliceId = response.body.user;
    if (name === "bob") bobId = response.body.user;
    if (name === "eve") eveId = response.body.user;
  }
});
after(async () => {
  sockets?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await db?.stop();
});
test("anonymous requests finish with 401 and health remains available", async () => {
  await request(app).get("/health").expect(200);
  await request(app).get("/jwtid").expect(401);
  await request(app)
    .post("/api/post")
    .send({ message: "unauthorized" })
    .expect(401);
  await request(app).get("/api/user").expect(401);
});
test("auth returns generic invalid-login errors, rejects injection, protects cross-origin mutations, cookie expires in 3 days", async () => {
  const response = await alice
    .post("/api/user/login")
    .send(credentials("alice"))
    .expect(200);
  const jwt = require("jsonwebtoken");
  const token = response.headers["set-cookie"][0].split(";")[0].slice(4);
  const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
  assert.equal(decoded.exp - decoded.iat, 259200);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
  await request(app)
    .post("/api/user/login")
    .send({ email: { $ne: null }, password: "x" })
    .expect(400);
  const missing = await request(app)
    .post("/api/user/login")
    .send({ email: "missing@example.test", password: "x" })
    .expect(401);
  const wrong = await request(app)
    .post("/api/user/login")
    .send({ email: credentials("alice").email, password: "x" })
    .expect(401);
  assert.deepEqual(missing.body, wrong.body);
  await alice
    .put(`/api/user/${aliceId}`)
    .set("Origin", "https://evil.example")
    .send({ bio: "attack" })
    .expect(403);
  await request(app)
    .post("/api/user/register")
    .send(credentials("alice"))
    .expect(409);
});
test("member directory and other profiles do not expose emails, hashes or private likes", async () => {
  const response = await alice.get("/api/user").expect(200);
  assert.equal(response.body.length, 3);
  for (const member of response.body) {
    assert.equal(member.password, undefined);
    assert.equal(member.email, undefined);
    assert.equal(member.likes, undefined);
  }
  const other = await alice.get(`/api/user/${bobId}`).expect(200);
  assert.equal(other.body.email, undefined);
  const me = await alice.get(`/api/user/${aliceId}`).expect(200);
  assert.equal(me.body.email, "alice@example.test");
  assert.equal(me.body.password, undefined);
});
test("profile ownership, follow/unfollow and repeated follows", async () => {
  await bob.put(`/api/user/${aliceId}`).send({ bio: "attack" }).expect(403);
  await alice
    .put(`/api/user/${aliceId}`)
    .send({ bio: "Course à pied" })
    .expect(200);
  await alice
    .patch(`/api/user/follow/${aliceId}`)
    .send({ idToFollow: aliceId })
    .expect(400);
  await bob
    .patch(`/api/user/follow/${aliceId}`)
    .send({ idToFollow: bobId })
    .expect(403);
  for (let i = 0; i < 2; i++)
    await alice
      .patch(`/api/user/follow/${aliceId}`)
      .send({ idToFollow: bobId })
      .expect(200);
  let me = await alice.get(`/api/user/${aliceId}`);
  assert.deepEqual(me.body.following, [bobId]);
  let target = await alice.get(`/api/user/${bobId}`);
  assert.deepEqual(target.body.followers, [aliceId]);
  await alice
    .patch(`/api/user/unfollow/${aliceId}`)
    .send({ idToUnfollow: bobId })
    .expect(200);
  target = await alice.get(`/api/user/${bobId}`);
  assert.deepEqual(target.body.followers, []);
});
test("text-only posts work, forged poster IDs and oversized text fail, ownership is enforced", async () => {
  await alice
    .post("/api/post")
    .send({ posterId: bobId, message: "forged" })
    .expect(403);
  await alice.post("/api/post").send({ message: "" }).expect(400);
  await alice
    .post("/api/post")
    .send({ message: "x".repeat(501) })
    .expect(400);
  const response = await alice
    .post("/api/post")
    .send({ message: "Sortie du matin" })
    .expect(201);
  postId = response.body._id;
  assert.equal(response.body.posterId, aliceId);
  await bob.put(`/api/post/${postId}`).send({ message: "attack" }).expect(403);
  await bob.delete(`/api/post/${postId}`).expect(403);
  await alice
    .put(`/api/post/${postId}`)
    .send({ message: "Sortie de 10 km" })
    .expect(200);
  const feed = await alice.get("/api/post").expect(200);
  assert.equal(feed.body[0].message, "Sortie de 10 km");
});
test("likes are idempotent and comments use the authenticated author", async () => {
  await bob
    .patch(`/api/post/like-post/${postId}`)
    .send({ id: aliceId })
    .expect(403);
  for (let i = 0; i < 2; i++)
    await bob
      .patch(`/api/post/like-post/${postId}`)
      .send({ id: bobId })
      .expect(200);
  let response = await bob
    .patch(`/api/post/comment-post/${postId}`)
    .send({ commenterPseudo: "alice", text: "Bravo !" })
    .expect(200);
  assert.deepEqual(response.body.likers, [bobId]);
  const comment = response.body.comments[0];
  commentId = comment._id;
  assert.equal(comment.commenterPseudo, "bob");
  assert.equal(comment.commenterId, bobId);
  await alice
    .patch(`/api/post/edit-comment-post/${postId}`)
    .send({ commentId, text: "attack" })
    .expect(403);
  await bob
    .patch(`/api/post/edit-comment-post/${postId}`)
    .send({ commentId, text: "Très belle sortie !" })
    .expect(200);
  response = await bob
    .patch(`/api/post/delete-comment-post/${postId}`)
    .send({ commentId })
    .expect(200);
  assert.equal(response.body.comments.length, 0);
  response = await bob
    .patch(`/api/post/unlike-post/${postId}`)
    .send({ id: bobId })
    .expect(200);
  assert.deepEqual(response.body.likers, []);
});
test("uploads reject false formats, excess size and cross-user profile changes; real PNG URLs are served", async () => {
  await alice
    .post("/api/post")
    .field("message", "test")
    .attach("file", Buffer.from("<html>attack</html>"), {
      filename: "attack.png",
      contentType: "image/png",
    })
    .expect(400);
  await alice
    .post("/api/post")
    .field("message", "test")
    .attach("file", Buffer.alloc(500001), {
      filename: "large.jpg",
      contentType: "image/jpeg",
    })
    .expect(413);
  const png = await require("sharp")({
    create: { width: 2, height: 2, channels: 3, background: "#2467e8" },
  })
    .png()
    .toBuffer();
  await alice
    .post("/api/post")
    .attach(
      "file",
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "damaged.png",
    )
    .expect(400);
  await bob
    .post("/api/user/upload")
    .field("userId", aliceId)
    .attach("file", png, "pic.png")
    .expect(403);
  const photo = await alice
    .post("/api/user/upload")
    .field("userId", aliceId)
    .field("name", "../../unsafe")
    .attach("file", png, "pic.png")
    .expect(200);
  assert.match(photo.body.picture, /^\/uploads\/profil\/[a-f0-9-]+\.png$/);
  assert.equal(photo.body.password, undefined);
  await request(app)
    .get(photo.body.picture)
    .expect(200)
    .expect("Content-Type", /image\/png/);
  await alice.post("/api/post").attach("file", png, "photo.png").expect(201);
});
test("conversations and messages require membership and cannot forge sender identities", async () => {
  const response = await alice
    .post("/api/conversations")
    .send({ receiverId: bobId })
    .expect(201);
  conversationId = response.body._id;
  const repeated = await alice
    .post("/api/conversations")
    .send({ receiverId: bobId })
    .expect(200);
  assert.equal(repeated.body._id, conversationId);
  await eve.get(`/api/messages/${conversationId}`).expect(403);
  await eve
    .post("/api/messages")
    .send({ conversationId, text: "attack" })
    .expect(403);
  await eve.get(`/api/conversations/${aliceId}`).expect(403);
  await alice
    .post("/api/messages")
    .send({ conversationId, sender: bobId, text: "forged" })
    .expect(403);
  await alice
    .post("/api/messages")
    .send({ conversationId, text: "À demain !" })
    .expect(201);
  const messages = await bob.get(`/api/messages/${conversationId}`).expect(200);
  assert.equal(messages.body[0].sender, aliceId);
  assert.equal(messages.body[0].text, "À demain !");
});
test("Socket.IO rejects anonymous clients and only relays persisted messages to the recipient", async () => {
  server = require("node:http").createServer(app);
  sockets = new (require("socket.io").Server)(server);
  app.set("io", sockets);
  require("../socket").default(sockets);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const anonymous = client(url, { reconnection: false, timeout: 2000 });
  await once(anonymous, "connect_error");
  anonymous.close();
  const login = await bob.post("/api/user/login").send(credentials("bob"));
  const socket = client(url, {
    extraHeaders: { Cookie: login.headers["set-cookie"][0].split(";")[0] },
    reconnection: false,
  });
  await once(socket, "connect");
  const received = once(socket, "getMessage");
  await alice
    .post("/api/messages")
    .send({ conversationId, text: "Message en direct" })
    .expect(201);
  const [message] = await received;
  assert.equal(message.text, "Message en direct");
  assert.equal(message.conversationId, conversationId);
  socket.close();
});
test("invalid boundaries, missing records, empty bio and concurrent conversation creation", async () => {
  await alice
    .post("/api/messages")
    .send({ conversationId, text: "x".repeat(2001) })
    .expect(400);
  await alice.get("/api/user/not-an-id").expect(400);
  await alice.get("/api/user/000000000000000000000000").expect(404);
  await alice.post("/api/post").send(["invalid"]).expect(400);
  const bio = await alice
    .put(`/api/user/${aliceId}`)
    .send({ bio: "" })
    .expect(200);
  assert.equal(bio.body.bio, "");
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      alice.post("/api/conversations").send({ receiverId: eveId }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200 || r.status === 201));
  assert.equal(new Set(results.map((r) => r.body._id)).size, 1);
  const Conversation = require("../models/conversation.model").default;
  assert.equal(
    await Conversation.countDocuments({ members: { $all: [aliceId, eveId] } }),
    1,
  );
});
test("deleting an account removes its conversations, messages, posts and social references", async () => {
  await eve.post("/api/post").send({ message: "Temporary post" }).expect(201);
  await alice
    .patch(`/api/user/follow/${aliceId}`)
    .send({ idToFollow: eveId })
    .expect(200);
  await eve
    .patch(`/api/post/like-post/${postId}`)
    .send({ id: eveId })
    .expect(200);
  await eve
    .patch(`/api/post/comment-post/${postId}`)
    .send({ text: "Temporary comment" })
    .expect(200);
  await eve.delete(`/api/user/${aliceId}`).expect(403);
  await eve.delete(`/api/user/${eveId}`).expect(204);
  await eve.get("/jwtid").expect(401);
  const members = await alice.get("/api/user").expect(200);
  assert.ok(!members.body.some((u) => u._id === eveId));
  const me = await alice.get(`/api/user/${aliceId}`).expect(200);
  assert.ok(!me.body.following.includes(eveId));
  const posts = await alice.get("/api/post").expect(200);
  assert.ok(
    posts.body.every(
      (p) =>
        p.posterId !== eveId &&
        !p.likers.includes(eveId) &&
        !p.comments.some((c) => c.commenterId === eveId),
    ),
  );
  const conversations = await alice
    .get(`/api/conversations/${aliceId}`)
    .expect(200);
  assert.ok(conversations.body.every((c) => !c.members.includes(eveId)));
});
test("delete post cleans likes and logout invalidates the browser cookie", async () => {
  await alice.delete(`/api/post/${postId}`).expect(204);
  await bob
    .patch(`/api/post/like-post/${postId}`)
    .send({ id: bobId })
    .expect(404);
  await alice.post("/api/user/logout").expect(204);
  await alice.get("/jwtid").expect(401);
});
