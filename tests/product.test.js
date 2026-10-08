const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { io: client } = require("socket.io-client");
const { once } = require("node:events");
process.env.TOKEN_SECRET = "product-test-secret-32-characters-minimum-only";
process.env.CLIENT_URL = "http://127.0.0.1:4313";
const app = require("../app").createApp();
const Conversation = require("../models/conversation.model").default;
const User = require("../models/user.model").default;
const Session = require("../models/session.model").default;
let db, server, io, url, alice, bob, eve, aliceId, bobId, conversation;
const sockets = [];
const cookie = (response) => response.headers["set-cookie"][0].split(";")[0];
async function connect(token) {
  const socket = client(url, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: token },
    reconnection: false,
  });
  sockets.push(socket);
  const ready = once(socket, "sessionReady", {
    signal: AbortSignal.timeout(4000),
  });
  socket.connect();
  await ready;
  return socket;
}
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([User.init(), Session.init(), Conversation.init()]);
  const users = [];
  for (const name of ["alice", "bob", "eve"]) {
    const response = await request(app)
      .post("/api/user/register")
      .send({
        pseudo: name,
        email: `${name}@example.test`,
        password: "Password123!",
      })
      .expect(201);
    users.push({ id: response.body.user, cookie: cookie(response) });
  }
  [
    { id: aliceId, cookie: alice },
    { id: bobId, cookie: bob },
    { cookie: eve },
  ] = users;
  conversation = (
    await request(app)
      .post("/api/conversations")
      .set("Cookie", alice)
      .send({ receiverId: bobId })
      .expect(201)
  ).body._id;
  server = createServer(app);
  io = new Server(server);
  require("../socket").default(io);
  app.set("io", io);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => io.close(resolve));
  await mongoose.disconnect();
  await db.stop();
});
test("inscription minimale: pseudo public indépendant de l’adresse, session immédiate, validation et doublons", async () => {
  const response = await request(app)
    .post("/api/user/register")
    .send({ email: "private-name@example.test", password: "Password123!" })
    .expect(201);
  const token = cookie(response);
  const jwtid = await request(app)
    .get("/jwtid")
    .set("Cookie", token)
    .expect(200);
  assert.equal(jwtid.body, response.body.user);
  const user = await User.findById(response.body.user);
  assert.match(user.pseudo, /^membre-[\da-f]{12}$/);
  assert.ok(!user.pseudo.includes("private-name"));
  await request(app)
    .post("/api/user/register")
    .send({ email: "private-name@example.test", password: "Password123!" })
    .expect(409);
  await request(app)
    .post("/api/user/register")
    .send({ email: "invalid", password: "short" })
    .expect(400);
  await request(app)
    .post("/api/user/register")
    .send({
      email: "other@example.test",
      password: "Password123!",
      pseudo: { $gt: "" },
    })
    .expect(400);
  await request(app)
    .get("/api/conversations/" + response.body.user)
    .set("Cookie", token)
    .expect(200);
});
test("épinglage privé persistant: concurrent et répété sans doublon, aucune fuite vers l’autre membre", async () => {
  const pin = () =>
    request(app)
      .patch(`/api/conversations/${conversation}/pin`)
      .set("Cookie", alice)
      .send({ pinned: true });
  const responses = await Promise.all([pin(), pin(), pin()]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.body.pinned, true);
    assert.equal(response.body.pinnedBy, undefined);
    assert.equal(response.body.key, undefined);
  }
  assert.deepEqual((await Conversation.findById(conversation)).pinnedBy, [
    aliceId,
  ]);
  const mine = await request(app)
    .get(`/api/conversations/${aliceId}`)
    .set("Cookie", alice)
    .expect(200);
  assert.equal(mine.body[0].pinned, true);
  const theirs = await request(app)
    .get(`/api/conversations/${bobId}`)
    .set("Cookie", bob)
    .expect(200);
  assert.equal(theirs.body[0].pinned, false);
  assert.equal(theirs.body[0].pinnedBy, undefined);
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", bob)
    .send({ pinned: true })
    .expect(200);
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", alice)
    .send({ pinned: false })
    .expect(200);
  assert.deepEqual((await Conversation.findById(conversation)).pinnedBy, [
    bobId,
  ]);
});
test("épinglage: frontières strictes, autorisation et anciens documents sans champ", async () => {
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", eve)
    .send({ pinned: true })
    .expect(403);
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", alice)
    .send({ pinned: "true" })
    .expect(400);
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", alice)
    .send({ pinned: true, userId: bobId })
    .expect(400);
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .send({ pinned: true })
    .expect(401);
  await Conversation.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(conversation) },
    { $unset: { pinnedBy: "" } },
  );
  const response = await request(app)
    .get(`/api/conversations/${aliceId}`)
    .set("Cookie", alice)
    .expect(200);
  assert.equal(response.body[0].pinned, false);
});
test("synchronisation des épingles dans deux onglets du compte uniquement; suppression cascade", async () => {
  const a1 = await connect(alice),
    a2 = await connect(alice),
    b = await connect(bob);
  let recipientEvents = 0;
  b.on("conversationsChanged", () => recipientEvents++);
  const event1 = once(a1, "conversationsChanged", {
      signal: AbortSignal.timeout(4000),
    }),
    event2 = once(a2, "conversationsChanged", {
      signal: AbortSignal.timeout(4000),
    });
  await request(app)
    .patch(`/api/conversations/${conversation}/pin`)
    .set("Cookie", alice)
    .send({ pinned: true })
    .expect(200);
  await Promise.all([event1, event2]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(recipientEvents, 0);
  await request(app)
    .delete(`/api/user/${aliceId}`)
    .set("Cookie", alice)
    .expect(204);
  assert.equal(await Conversation.findById(conversation), null);
});
