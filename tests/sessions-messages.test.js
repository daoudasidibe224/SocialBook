const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const { Server } = require("socket.io");
const { io: client } = require("socket.io-client");
const jwt = require("jsonwebtoken");
process.env.TOKEN_SECRET = "isolated-sessions-test-secret-12345678901234567890";
process.env.CLIENT_URL = "http://127.0.0.1:4313";
const app = require("../app").createApp();
const initialize = require("../socket").default;
const Session = require("../models/session.model").default;
const User = require("../models/user.model").default;
const Message = require("../models/message.model").default;
const Conversation = require("../models/conversation.model").default;
let db, server, io, url, alice, bob, aliceId, bobId, conversation;
const connected = [];
const credentials = (name) => ({
  pseudo: name,
  email: `${name}@example.test`,
  password: "Password123!",
});
const event = (socket, name) =>
  once(socket, name, { signal: AbortSignal.timeout(4000) });
async function login(name) {
  const result = await request(app)
    .post("/api/user/login")
    .send(credentials(name))
    .expect(200);
  return result.headers["set-cookie"][0].split(";")[0];
}
async function open(cookie) {
  const socket = client(url, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
    autoConnect: false,
  });
  connected.push(socket);
  const ready = event(socket, "sessionReady");
  socket.connect();
  await ready;
  return socket;
}
function payload(text = "Séance du samedi") {
  return { conversationId: conversation, text, requestId: crypto.randomUUID() };
}
const send = (cookie, input) =>
  request(app).post("/api/messages").set("Cookie", cookie).send(input);
before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([
    User.init(),
    Session.init(),
    Message.init(),
    Conversation.init(),
  ]);
  for (const name of ["alice", "bob"])
    await request(app)
      .post("/api/user/register")
      .send(credentials(name))
      .expect(201);
  alice = await login("alice");
  bob = await login("bob");
  aliceId = (
    await request(app).get("/jwtid").set("Cookie", alice)
  ).text.replaceAll('"', "");
  bobId = (await request(app).get("/jwtid").set("Cookie", bob)).text.replaceAll(
    '"',
    "",
  );
  conversation = (
    await request(app)
      .post("/api/conversations")
      .set("Cookie", alice)
      .send({ receiverId: bobId })
      .expect(201)
  ).body._id;
  server = createServer(app);
  io = new Server(server);
  initialize(io);
  app.set("io", io);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const socket of connected) socket.disconnect();
  if (io) await new Promise((resolve) => io.close(resolve));
  await mongoose.disconnect();
  await db.stop();
});
test("la session persistée porte un identifiant unique et une expiration TTL; les anciens jetons sont refusés", async () => {
  const decoded = jwt.verify(alice.slice(4), process.env.TOKEN_SECRET);
  assert.match(decoded.sid, /^[\da-f-]{36}$/);
  assert.equal(decoded.id, aliceId);
  assert.ok(await Session.findById(decoded.sid));
  const indexes = await Session.collection.indexes();
  assert.ok(
    indexes.some(
      (index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0,
    ),
  );
  const legacy = jwt.sign({ id: aliceId }, process.env.TOKEN_SECRET, {
    expiresIn: "3d",
  });
  await request(app).get("/jwtid").set("Cookie", `jwt=${legacy}`).expect(401);
  assert.notEqual(jwt.decode((await login("alice")).slice(4)).sid, decoded.sid);
});
test("les requêtes simultanées et leurs reprises gardent un seul message et synchronisent les deux onglets émetteurs", async () => {
  const a = await open(alice),
    a2 = await open(alice),
    b = await open(bob);
  const received = [[], [], []];
  [a, a2, b].forEach((socket, i) =>
    socket.on("getMessage", (message) => received[i].push(message)),
  );
  const input = payload();
  const firstEvents = [
    event(a, "getMessage"),
    event(a2, "getMessage"),
    event(b, "getMessage"),
  ];
  const responses = await Promise.all([send(alice, input), send(alice, input)]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 201],
  );
  await Promise.all(firstEvents);
  assert.equal(responses[0].body._id, responses[1].body._id);
  assert.equal(
    await Message.countDocuments({
      sender: aliceId,
      requestId: input.requestId,
    }),
    1,
  );
  await send(alice, { ...input, text: "Autre intention" }).expect(409);
  await send(alice, { ...input, requestId: "invalide" }).expect(400);
  const replay = await send(alice, input).expect(200);
  assert.equal(replay.body._id, responses[0].body._id);
  for (const messages of received) {
    assert.ok(messages.length >= 1);
    assert.ok(messages.every((message) => message._id === replay.body._id));
  }
  a.disconnect();
  a2.disconnect();
  b.disconnect();
});
test("une panne après création est réparable: reprise, activité restaurée et livraison du message déjà persisté", async (context) => {
  const b = await open(bob);
  const input = payload("Créé avant la panne");
  context.mock.method(
    Conversation,
    "updateOne",
    () => Promise.reject(new Error("isolated downstream write failure")),
    { times: 1 },
  );
  await send(alice, input).expect(500);
  const persisted = await Message.findOne({
    sender: aliceId,
    requestId: input.requestId,
  });
  assert.ok(persisted);
  const delivered = event(b, "getMessage");
  const replay = await send(alice, input).expect(200);
  const [message] = await delivered;
  assert.equal(message._id, String(persisted._id));
  assert.equal(replay.body._id, message._id);
  assert.equal(
    await Message.countDocuments({
      sender: aliceId,
      requestId: input.requestId,
    }),
    1,
  );
  assert.ok(
    (await Conversation.findById(conversation)).updatedAt >=
      persisted.createdAt,
  );
  const activity = (
    await Conversation.findById(conversation)
  ).updatedAt.getTime();
  await send(alice, input).expect(200);
  assert.equal(
    (await Conversation.findById(conversation)).updatedAt.getTime(),
    activity,
  );
  b.disconnect();
});
test("un destinataire reconnecté retrouve les messages manqués dans le même ordre", async () => {
  const b = await open(bob);
  b.disconnect();
  const input = payload("Message pendant une coupure");
  const response = await send(alice, input).expect(201);
  const reconnected = await open(bob);
  const history = await request(app)
    .get(`/api/messages/${conversation}`)
    .set("Cookie", bob)
    .expect(200);
  assert.equal(
    history.body.filter((message) => message._id === response.body._id).length,
    1,
  );
  assert.equal(history.body.at(-1).text, input.text);
  reconnected.disconnect();
});
test("la déconnexion révoque le jeton copié et les deux sockets de cette session, sans fermer un autre appareil", async () => {
  const cookie = await login("alice"),
    other = await login("alice");
  const a = await open(cookie),
    a2 = await open(cookie),
    device = await open(other);
  const gone = [event(a, "disconnect"), event(a2, "disconnect")];
  await request(app).post("/api/user/logout").set("Cookie", cookie).expect(204);
  await Promise.all(gone);
  await request(app).get("/jwtid").set("Cookie", cookie).expect(401);
  await request(app).get("/jwtid").set("Cookie", other).expect(200);
  assert.equal(device.connected, true);
  const denied = client(url, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
    autoConnect: false,
  });
  connected.push(denied);
  const rejected = event(denied, "connect_error");
  denied.connect();
  await rejected;
  assert.equal(denied.connected, false);
  denied.disconnect();
  device.disconnect();
});
test("la session expirée ferme aussi son socket et devient invalide en HTTP", async () => {
  const cookie = await login("alice");
  const sid = jwt.decode(cookie.slice(4)).sid;
  await Session.updateOne(
    { _id: sid },
    { $set: { expiresAt: new Date(Date.now() + 500) } },
  );
  const a = await open(cookie);
  const gone = event(a, "disconnect");
  await gone;
  await request(app).get("/jwtid").set("Cookie", cookie).expect(401);
});
test("une déconnexion pendant un handshake retardé ne laisse aucun socket révoqué actif", async (context) => {
  const cookie = await login("alice");
  let release, entered;
  const waiting = new Promise((resolve) => (entered = resolve));
  const barrier = new Promise((resolve) => (release = resolve));
  const original = User.findById.bind(User);
  context.mock.method(User, "findById", (...args) => {
    const query = original(...args);
    const select = query.select.bind(query);
    query.select = (fields) => {
      const selected = select(fields);
      if (fields !== "_id") return selected;
      return (async () => {
        const user = await selected;
        entered();
        await barrier;
        return user;
      })();
    };
    return query;
  });
  const socket = client(url, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie },
    reconnection: false,
    autoConnect: false,
  });
  connected.push(socket);
  let ready = false;
  socket.on("sessionReady", () => (ready = true));
  const gone = event(socket, "disconnect");
  socket.connect();
  await waiting;
  await request(app).post("/api/user/logout").set("Cookie", cookie).expect(204);
  release();
  await gone;
  assert.equal(socket.connected, false);
  assert.equal(ready, false);
  await request(app).get("/jwtid").set("Cookie", cookie).expect(401);
});
test("supprimer le compte révoque toutes ses sessions et toutes ses connexions", async () => {
  const cookie = await login("bob"),
    other = await login("bob");
  const first = await open(cookie),
    second = await open(other);
  const gone = [event(first, "disconnect"), event(second, "disconnect")];
  await request(app)
    .delete(`/api/user/${bobId}`)
    .set("Cookie", cookie)
    .expect(204);
  await Promise.all(gone);
  assert.equal(await Session.countDocuments({ userId: bobId }), 0);
  await request(app).get("/jwtid").set("Cookie", other).expect(401);
});
