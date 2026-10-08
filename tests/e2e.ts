import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import sharp from "sharp";
import { Server } from "socket.io";
import { createApp } from "../app";
import User from "../models/user.model";
import Conversation from "../models/conversation.model";
import Message from "../models/message.model";
import Session from "../models/session.model";
import Post from "../models/post.model";
import type { ServerEvents, SocketIdentity } from "../socket";
import initializeSocket from "../socket";
async function run() {
  process.env.TOKEN_SECRET = "isolated-e2e-secret-with-at-least-32-characters";
  process.env.CLIENT_URL = "http://127.0.0.1:4513";
  const imageDirectory = await mkdtemp(
    path.join(tmpdir(), "social-e2e-photos-"),
  );
  process.env.UPLOAD_DIRECTORY = imageDirectory;
  const app = createApp();
  const url = process.env.CLIENT_URL;
  const database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await Promise.all([
    User.init(),
    Conversation.init(),
    Message.init(),
    Session.init(),
    Post.init(),
  ]);
  const server = createServer(app);
  const sockets = new Server<
    Record<string, never>,
    ServerEvents,
    Record<string, never>,
    SocketIdentity
  >(server, {
    cors: { origin: url, credentials: true },
  });
  initializeSocket(sockets);
  app.set("io", sockets);
  await new Promise<void>((resolve) =>
    server.listen(5013, "127.0.0.1", resolve),
  );
  const vite = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4513"],
    {
      cwd: path.resolve("client"),
      env: { ...process.env, VITE_API_URL: "http://127.0.0.1:5013" },
      stdio: "pipe",
    },
  );
  let viteLog = "";
  vite.stderr.on("data", (data) => {
    viteLog += String(data);
  });
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const screenshots = process.env.SOCIAL_SCREENSHOTS;
  async function capture(page: Page, label: string) {
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(screenshots, `${label}.png`),
        fullPage: false,
      });
    }
  }
  async function check(page: Page) {
    await expect(page.locator("body")).toContainText("Communauté sportive");
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("*")]
        .filter(
          (element) => element.getBoundingClientRect().right > innerWidth + 1,
        )
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
        }))
        .slice(0, 15),
    }));
    if (overflow.scroll > overflow.width) {
      await capture(page, `social-overflow-${overflow.width}`);
      console.error(page.url(), JSON.stringify(overflow));
    }
    assert.ok(overflow.scroll <= overflow.width, "Horizontal overflow");
  }
  async function doubleSubmit(page: Page, label: string) {
    await expect
      .poll(() =>
        page.getByLabel(label, { exact: true }).evaluate((element) => {
          const button = element
            .closest("form")
            ?.querySelector("button:not([type=button])");
          return button instanceof HTMLButtonElement && !button.disabled;
        }),
      )
      .toBe(true);
    await page.getByLabel(label, { exact: true }).evaluate((element) => {
      const form = element.closest("form");
      if (!(form instanceof HTMLFormElement))
        throw new Error("Formulaire introuvable");
      form.requestSubmit();
      form.requestSubmit();
    });
  }
  async function login(page: Page, email: string) {
    await page.goto(url);
    await page.locator(".auth-card, .composer").first().waitFor();
    if (
      await page
        .getByRole("heading", { name: "Fil d’actualité", exact: true })
        .isVisible()
    )
      return;
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("Password123!");
    await page
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Fil d’actualité", exact: true }),
    ).toBeVisible();
  }
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log("session epoch / minimal signup / expiration");
    const minimalContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const minimalPage = await minimalContext.newPage();
    minimalPage.on("pageerror", (error) => errors.push(error.message));
    await minimalPage.goto(url + "/message");
    await expect(
      minimalPage.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    let releaseOldSession: () => void = () => {};
    const oldSessionGate = new Promise<void>((resolve) => {
      releaseOldSession = resolve;
    });
    let oldSessionStarted: () => void = () => {};
    const oldSessionRequest = new Promise<void>((resolve) => {
      oldSessionStarted = resolve;
    });
    let heldOldSession = false;
    await minimalPage.route("**/jwtid", async (route) => {
      if (heldOldSession) {
        await route.continue();
        return;
      }
      heldOldSession = true;
      const response = await route.fetch();
      assert.equal(response.status(), 401);
      oldSessionStarted();
      await oldSessionGate;
      await route.fulfill({ response });
    });
    await minimalPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await oldSessionRequest;
    await minimalPage
      .getByRole("button", { name: "Créer un compte", exact: true })
      .click();
    await expect(
      minimalPage.getByLabel("Pseudo (facultatif)", { exact: true }),
    ).toBeHidden();
    await minimalPage
      .getByLabel("Adresse e-mail")
      .fill("private-minimal@example.test");
    await minimalPage
      .getByLabel("Mot de passe", { exact: true })
      .fill("Password123!");
    await minimalPage
      .getByRole("button", { name: "Afficher le mot de passe" })
      .click();
    await expect(
      minimalPage.getByLabel("Mot de passe", { exact: true }),
    ).toHaveAttribute("type", "text");
    await doubleSubmit(minimalPage, "Adresse e-mail");
    await expect(
      minimalPage.getByRole("heading", {
        name: "Fil d’actualité",
        exact: true,
      }),
    ).toBeVisible();
    releaseOldSession();
    await minimalPage.waitForTimeout(200);
    await expect(
      minimalPage.getByRole("heading", {
        name: "Fil d’actualité",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      minimalPage.getByRole("button", { name: "Créer un compte", exact: true }),
    ).toHaveCount(0);
    const minimalUser = await User.findOne({
      email: "private-minimal@example.test",
    });
    assert.ok(minimalUser);
    assert.ok(!minimalUser.pseudo.includes("private-minimal"));
    console.log(
      "cross-tab identity replacement / private bookmarks and drafts",
    );
    const accountBContext = await browser.newContext();
    const accountBRegistration = await accountBContext.request.post(
      "http://127.0.0.1:5013/api/user/register",
      {
        data: {
          pseudo: "sessionB",
          email: "session-b@example.test",
          password: "Password123!",
        },
      },
    );
    assert.equal(accountBRegistration.status(), 201);
    const accountB = await accountBRegistration.json();
    await accountBContext.close();
    const bookmarkPostResponse = await minimalContext.request.post(
      "http://127.0.0.1:5013/api/post",
      {
        data: {
          message: "Une publication pour vérifier le scope privé",
          requestId: crypto.randomUUID(),
        },
      },
    );
    assert.equal(bookmarkPostResponse.status(), 201);
    const bookmarkPost = await bookmarkPostResponse.json();
    await minimalPage.evaluate(
      ({ userId, postId }) =>
        localStorage.setItem(
          `trainingbook:saved:${userId}`,
          JSON.stringify([postId]),
        ),
      { userId: String(minimalUser._id), postId: bookmarkPost._id },
    );
    await minimalPage.reload();
    await expect(
      minimalPage.getByRole("button", {
        name: "Retirer des sauvegardes",
        exact: true,
      }),
    ).toHaveCount(1);
    await minimalPage.goto(url + `/message?with=${accountB.user}`);
    await minimalPage
      .getByLabel("Votre message", { exact: true })
      .fill("Brouillon privé du premier compte");
    await expect
      .poll(() =>
        minimalPage.evaluate(() =>
          Object.values(localStorage).some((value) =>
            value.includes("Brouillon privé du premier compte"),
          ),
        ),
      )
      .toBe(true);
    const minimalPeer = await minimalContext.newPage();
    await minimalPeer.goto(url + `/message?with=${accountB.user}`);
    await expect(
      minimalPeer.getByLabel("Votre message", { exact: true }),
    ).toHaveValue("Brouillon privé du premier compte");
    await minimalContext.request.post("http://127.0.0.1:5013/api/user/login", {
      data: { email: "session-b@example.test", password: "Password123!" },
    });
    await minimalPeer.bringToFront();
    await minimalPeer.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      minimalPeer.getByRole("heading", {
        name: "Fil d’actualité",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      minimalPeer.getByRole("button", {
        name: "Retirer des sauvegardes",
        exact: true,
      }),
    ).toHaveCount(0);
    await minimalPage.bringToFront();
    await minimalPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      minimalPage.getByRole("heading", {
        name: "Fil d’actualité",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      minimalPage.getByRole("button", {
        name: "Retirer des sauvegardes",
        exact: true,
      }),
    ).toHaveCount(0);
    await minimalPage.goto(url + `/message?with=${minimalUser._id}`);
    await expect(
      minimalPage.getByLabel("Votre message", { exact: true }),
    ).toHaveValue("");
    await minimalContext.request.post("http://127.0.0.1:5013/api/user/login", {
      data: { email: "private-minimal@example.test", password: "Password123!" },
    });
    await minimalPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      minimalPage.getByRole("heading", {
        name: "Fil d’actualité",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      minimalPage.getByRole("button", {
        name: "Retirer des sauvegardes",
        exact: true,
      }),
    ).toHaveCount(1);
    await minimalPeer.close();
    await check(minimalPage);
    await Session.updateMany(
      { userId: String(minimalUser._id) },
      { $set: { expiresAt: new Date(0) } },
    );
    await minimalPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      minimalPage.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    await expect(
      minimalPage.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveCount(0);
    await minimalContext.close();
    await User.deleteMany({ _id: { $in: [minimalUser._id, accountB.user] } });
    await Session.deleteMany({
      userId: { $in: [String(minimalUser._id), accountB.user] },
    });
    await Post.deleteMany({ posterId: String(minimalUser._id) });
    await Conversation.deleteMany({ members: String(minimalUser._id) });
    const alice = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const bob = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const a = await alice.newPage();
    const b = await bob.newPage();
    for (const page of [a, b]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().includes("401") &&
          !message.text().includes("ERR_FAILED")
        )
          errors.push(message.text());
      });
    }
    console.log("auth");
    await a.goto(url + "/message");
    await expect(
      a.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    await expect(a.getByRole("button", { name: "Se déconnecter" })).toHaveCount(
      0,
    );
    await check(a);
    await capture(a, "social-auth-desktop");
    for (const width of [1440, 800, 390, 320]) {
      await a.setViewportSize({ width, height: 844 });
      await check(a);
      await capture(a, `social-auth-${width}`);
    }
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.emulateMedia({ reducedMotion: "reduce" });
    await a
      .getByRole("button", { name: "Créer un compte", exact: true })
      .click();
    for (const width of [1440, 800, 390, 320]) {
      await a.setViewportSize({ width, height: 844 });
      await check(a);
      await capture(a, `social-register-${width}`);
      if (width < 400) {
        const button = await a
          .getByRole("button", { name: "Créer mon compte", exact: true })
          .boundingBox();
        assert.ok(
          button && button.y + button.height < 844,
          "Inscription visible dès la première vue",
        );
      }
    }
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a
      .getByText("Choisir un pseudo (facultatif)", { exact: true })
      .click();
    await a.getByLabel("Pseudo (facultatif)", { exact: true }).fill("alice");
    await a.getByLabel("Adresse e-mail").fill("alice@example.test");
    await a.getByLabel("Mot de passe", { exact: true }).fill("Password123!");
    await a.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(
      a.getByRole("heading", { name: "Fil d’actualité", exact: true }),
    ).toBeVisible();
    const register = await bob.request.post(
      "http://127.0.0.1:5013/api/user/register",
      {
        data: {
          pseudo: "bob",
          email: "bob@example.test",
          password: "Password123!",
        },
      },
    );
    assert.equal(register.status(), 201);
    console.log("accounts");
    await login(a, "alice@example.test");
    await login(b, "bob@example.test");
    console.log("recoverable post/photo drafts");
    const aliceId = String((await User.findOne({ pseudo: "alice" }))?._id);
    const draftKey = `community-sportive-draft:${aliceId}:post`;
    const draftPhoto = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "#2467e8" },
    })
      .png()
      .toBuffer();
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Photo et intention récupérables");
    await a.getByLabel("Ajouter une photo", { exact: true }).setInputFiles({
      name: "draft.png",
      mimeType: "image/png",
      buffer: draftPhoto,
    });
    await expect
      .poll(() =>
        a.evaluate((key) => Boolean(localStorage.getItem(key)), draftKey),
      )
      .toBe(true);
    const storedPhoto = await a.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
      draftKey,
    );
    assert.equal(storedPhoto.photo.content, draftPhoto.toString("base64"));
    await a.reload();
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Photo et intention récupérables");
    await expect(a.getByAltText("Photo à publier")).toBeVisible();
    let lostPhotoKey = "";
    await a.route("**/api/post", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      lostPhotoKey =
        route
          .request()
          .postData()
          ?.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1] ?? "";
      await route.fetch();
      await route.abort();
    });
    await doubleSubmit(a, "Votre publication");
    await expect(a.locator(".composer [role=alert]")).toBeVisible();
    assert.equal(lostPhotoKey, storedPhoto.requestId);
    await a.unroute("**/api/post");
    await a.reload();
    await expect(a.getByAltText("Photo à publier")).toBeVisible();
    const resumed = a.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/post"),
    );
    await doubleSubmit(a, "Votre publication");
    assert.equal((await resumed).status(), 200);
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("");
    assert.equal(
      await Post.countDocuments({
        message: "Photo et intention récupérables",
        deletedAt: null,
      }),
      1,
    );
    const draftPost = await Post.findOne({
      message: "Photo et intention récupérables",
    });
    assert.ok(draftPost);
    await alice.request.delete(
      `http://127.0.0.1:5013/api/post/${draftPost._id}`,
    );
    await a.reload();
    await expect(a.locator(".post-card")).toHaveCount(0);
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Derniers caractères avant navigation");
    await a
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Explorer", exact: true })
      .click();
    await a
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Fil d’actualité", exact: true })
      .click();
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Derniers caractères avant navigation");
    await a.reload();
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Derniers caractères avant navigation");
    await a
      .getByRole("button", { name: "Effacer le brouillon", exact: true })
      .click();
    // Deux saisies concurrentes: aucune version n'écrase silencieusement l'autre.
    const otherDraft = await alice.newPage();
    await otherDraft.goto(url + "/home");
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Version de cet onglet");
    await otherDraft
      .getByLabel("Votre publication", { exact: true })
      .fill("Version de l’autre onglet");
    await expect
      .poll(
        async () =>
          (await a.getByRole("button", { name: "Garder ma saisie" }).count()) +
          (await otherDraft
            .getByRole("button", { name: "Garder ma saisie" })
            .count()),
      )
      .toBeGreaterThan(0);
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Version de cet onglet");
    await expect(
      otherDraft.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Version de l’autre onglet");
    if (await a.getByRole("button", { name: "Garder ma saisie" }).isVisible())
      await a.getByRole("button", { name: "Garder ma saisie" }).click();
    else
      await otherDraft
        .getByRole("button", { name: "Charger l’autre version" })
        .click();
    await otherDraft.close();
    await a
      .getByRole("button", { name: "Effacer le brouillon", exact: true })
      .click();
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("");
    await a.reload();
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("");
    await a.evaluate(
      (key) => localStorage.setItem(key, "{malformed"),
      draftKey,
    );
    await a.reload();
    await expect(a.locator(".composer [role=status]")).toContainText(
      "invalide",
    );
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("");
    await a.evaluate((key) => localStorage.removeItem(key), draftKey);
    await a.reload();
    // Un quota de stockage ne perd pas la saisie et ne bloque pas une publication en ligne.
    await a.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Brouillon mémoire uniquement");
    await expect(a.locator(".composer [role=status]")).toContainText(
      "indisponible",
    );
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Brouillon mémoire uniquement");
    await a.reload();
    console.log("post");
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Sortie de 10 km sur les quais");
    let postRetryKey = "";
    await a.route("**/api/post", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      postRetryKey =
        route
          .request()
          .postData()
          ?.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1] ?? "";
      await route.abort();
    });
    await doubleSubmit(a, "Votre publication");
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Sortie de 10 km sur les quais");
    await expect(a.locator(".composer [role=alert]")).toBeVisible();
    assert.ok(postRetryKey);
    await a.unroute("**/api/post");
    const published = a.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/api/post"),
    );
    await doubleSubmit(a, "Votre publication");
    assert.ok((await published).postData()?.includes(postRetryKey));
    await expect(a.locator(".post-message")).toHaveText(
      "Sortie de 10 km sur les quais",
    );
    await b.reload();
    await b
      .getByRole("button", { name: "Aimer la publication", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Retirer le j’aime", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await b.getByRole("button", { name: /Commentaires/ }).click();
    await b
      .getByLabel("Votre commentaire", { exact: true })
      .fill("Bravo pour cette séance !");
    let commentRetryBody = "";
    await b.route("**/api/post/comment-post/*", async (route) => {
      commentRetryBody = route.request().postData() ?? "";
      await route.abort();
    });
    await doubleSubmit(b, "Votre commentaire");
    await expect(b.locator(".post-card [role=alert]")).toBeVisible();
    await expect(
      b.getByLabel("Votre commentaire", { exact: true }),
    ).toHaveValue("Bravo pour cette séance !");
    await b.unroute("**/api/post/comment-post/*");
    const commentRequest = b.waitForRequest((request) =>
      request.url().includes("/comment-post/"),
    );
    await doubleSubmit(b, "Votre commentaire");
    assert.equal((await commentRequest).postData(), commentRetryBody);
    await expect(b.locator(".comment")).toContainText(
      "Bravo pour cette séance !",
    );
    assert.equal(await Post.countDocuments({ deleted: false }), 1);
    const persistedPost = await Post.findOne({ deleted: false });
    assert.ok(persistedPost);
    assert.equal(persistedPost.comments.length, 1);
    await a.reload();
    await a.getByRole("button", { name: "Sauvegarder la publication" }).click();
    await a
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Sauvegardés" })
      .click();
    await expect(a.locator(".post-message")).toHaveText(
      "Sortie de 10 km sur les quais",
    );
    await a.reload();
    await expect(a.locator(".post-message")).toHaveText(
      "Sortie de 10 km sur les quais",
    );
    await a.getByRole("button", { name: "Options de la publication" }).click();
    await a.getByRole("button", { name: "Modifier", exact: true }).click();
    await expect(a.getByRole("dialog")).toBeVisible();
    const a2 = await alice.newPage();
    a2.on("pageerror", (error) => errors.push(error.message));
    await a2.goto(url + "/home");
    await a2.getByRole("button", { name: "Options de la publication" }).click();
    await a2.getByRole("button", { name: "Modifier", exact: true }).click();
    await a2
      .getByRole("dialog")
      .getByLabel("Texte")
      .fill("Modification périmée conservée");
    await a.getByRole("dialog").getByLabel("Texte").fill("Sortie de 12 km");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enregistrer" })
      .click();
    await expect(a.locator(".post-message")).toHaveText("Sortie de 12 km");
    await a2
      .getByRole("dialog")
      .getByRole("button", { name: "Enregistrer" })
      .click();
    await expect(a2.getByRole("dialog").getByRole("alert")).toContainText(
      "changé",
    );
    await expect(a2.getByRole("dialog").getByLabel("Texte")).toHaveValue(
      "Modification périmée conservée",
    );
    await a2.keyboard.press("Escape");
    console.log("profile and chat");
    await a
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Explorer" })
      .click();
    await a
      .locator(".discover-members")
      .getByRole("button")
      .filter({ hasText: "bob" })
      .click();
    await a.getByRole("button", { name: "Suivre", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Suivi", exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Message", exact: true }).click();
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("On court demain ?");
    await doubleSubmit(a, "Votre message");
    await expect(a.locator(".chat-messages")).toContainText(
      "On court demain ?",
    );
    await b
      .getByRole("navigation", { name: "Navigation mobile" })
      .getByRole("link", { name: "Messages", exact: true })
      .click();
    await b.locator(".chat-contact").filter({ hasText: "alice" }).click();
    await expect(b.locator(".chat-messages")).toContainText(
      "On court demain ?",
    );
    await a2.goto(url + "/message");
    await a2
      .locator(".chat-contact")
      .filter({ hasText: "bob" })
      .first()
      .click();
    await expect(a2.locator(".chat-messages")).toContainText(
      "On court demain ?",
    );
    await expect(
      a.locator(".chat-messages p").filter({ hasText: "On court demain ?" }),
    ).toHaveCount(1);
    assert.equal(
      await Message.countDocuments({ text: "On court demain ?" }),
      1,
    );
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Confirmation après réponse perdue");
    let messageRetryBody = "";
    await a.route("**/api/messages", async (route) => {
      messageRetryBody = route.request().postData() ?? "";
      await route.fetch();
      await route.abort();
    });
    await doubleSubmit(a, "Votre message");
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Confirmation après réponse perdue",
    );
    await expect(a.locator(".chat-main [role=alert]")).toBeVisible();
    await a.unroute("**/api/messages");
    await a.reload();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Confirmation après réponse perdue",
    );
    const retryMessage = a.waitForRequest(
      (request) =>
        request.url().endsWith("/api/messages") && request.method() === "POST",
    );
    await doubleSubmit(a, "Votre message");
    assert.equal((await retryMessage).postData(), messageRetryBody);
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      a
        .locator(".chat-messages p")
        .filter({ hasText: "Confirmation après réponse perdue" }),
    ).toHaveCount(1);
    await expect(
      a2
        .locator(".chat-messages p")
        .filter({ hasText: "Confirmation après réponse perdue" }),
    ).toHaveCount(1);
    await expect(
      b
        .locator(".chat-messages p")
        .filter({ hasText: "Confirmation après réponse perdue" }),
    ).toHaveCount(1);
    assert.equal(
      await Message.countDocuments({
        text: "Confirmation après réponse perdue",
      }),
      1,
    );
    console.log("private pins / search / recoverable message drafts");
    await a
      .getByRole("button", { name: "Épingler la conversation", exact: true })
      .click();
    await expect(
      a.getByRole("button", {
        name: "Désépingler la conversation",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      a2.getByRole("button", {
        name: "Désépingler la conversation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Épingler la conversation", exact: true }),
    ).toBeVisible();
    await a
      .getByLabel("Rechercher dans cette conversation", { exact: true })
      .fill("REPONSE PERDUE");
    await expect(a.locator(".chat-messages .message")).toHaveCount(1);
    await a
      .getByLabel("Rechercher dans cette conversation", { exact: true })
      .fill("introuvable");
    await expect(a.locator(".chat-messages")).toContainText("Aucun message");
    await a.getByRole("button", { name: "Effacer la recherche" }).click();
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Un brouillon pour cette conversation");
    await expect
      .poll(() =>
        a.evaluate(
          () =>
            Object.keys(localStorage).filter((key) => key.includes(":message:"))
              .length,
        ),
      )
      .toBe(1);
    await a.reload();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Un brouillon pour cette conversation",
    );
    await expect(
      a.getByRole("button", {
        name: "Désépingler la conversation",
        exact: true,
      }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "Effacer le brouillon", exact: true })
      .click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "",
    );
    const thirdContext = await browser.newContext();
    const thirdRegistration = await thirdContext.request.post(
      "http://127.0.0.1:5013/api/user/register",
      {
        data: {
          pseudo: "charlie",
          email: "charlie@example.test",
          password: "Password123!",
        },
      },
    );
    assert.equal(thirdRegistration.status(), 201);
    const thirdUser = await thirdRegistration.json();
    await alice.request.post("http://127.0.0.1:5013/api/conversations", {
      data: { receiverId: thirdUser.user },
    });
    await thirdContext.close();
    await a.reload();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Texte juste avant changement de conversation");
    await a
      .locator(".chat-contact")
      .filter({ hasText: "charlie" })
      .first()
      .click();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Texte juste avant changement de conversation",
    );
    await a.reload();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Texte juste avant changement de conversation",
    );
    await a
      .getByRole("button", { name: "Effacer le brouillon", exact: true })
      .click();
    console.log("late message response");
    let releaseResponse: () => void = () => {};
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let persistedRequest: () => void = () => {};
    const requestPersisted = new Promise<void>((resolve) => {
      persistedRequest = resolve;
    });
    await a.route("**/api/messages", async (route) => {
      const response = await route.fetch();
      persistedRequest();
      await responseGate;
      await route.fulfill({ response });
    });
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Réponse tardive dans la première conversation");
    await doubleSubmit(a, "Votre message");
    await Promise.race([
      requestPersisted,
      new Promise<void>((_, reject) =>
        setTimeout(() => {
          releaseResponse();
          reject(new Error("Le message retardé n’a pas atteint l’API."));
        }, 10000),
      ),
    ]);
    await a
      .locator(".chat-contact")
      .filter({ hasText: "charlie" })
      .first()
      .click();
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Brouillon distinct pour Charlie");
    await expect
      .poll(() =>
        a.evaluate(() =>
          Object.values(localStorage).some((value) =>
            value.includes("Brouillon distinct pour Charlie"),
          ),
        ),
      )
      .toBe(true);
    releaseResponse();
    await expect(
      a.getByRole("button", { name: "Envoyer le message" }),
    ).toBeEnabled();
    await a.unroute("**/api/messages");
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Brouillon distinct pour Charlie",
    );
    await a.reload();
    await a
      .locator(".chat-contact")
      .filter({ hasText: "charlie" })
      .first()
      .click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "Brouillon distinct pour Charlie",
    );
    await a
      .getByRole("button", { name: "Effacer le brouillon", exact: true })
      .click();
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "",
    );
    assert.equal(
      await Message.countDocuments({
        text: "Réponse tardive dans la première conversation",
      }),
      1,
    );
    await bob.setOffline(true);
    await a
      .getByLabel("Votre message", { exact: true })
      .fill("Message pendant la coupure");
    await doubleSubmit(a, "Votre message");
    await expect(a.getByLabel("Votre message", { exact: true })).toHaveValue(
      "",
    );
    await bob.setOffline(false);
    await expect(b.locator(".chat-messages")).toContainText(
      "Message pendant la coupure",
      { timeout: 15000 },
    );
    await expect(
      b
        .locator(".chat-messages p")
        .filter({ hasText: "Message pendant la coupure" }),
    ).toHaveCount(1);
    await b
      .getByLabel("Votre message", { exact: true })
      .fill("Oui, à 9 heures.");
    await b
      .getByRole("button", { name: "Envoyer le message", exact: true })
      .click();
    await expect(a.locator(".chat-messages")).toContainText("Oui, à 9 heures.");
    await check(b);
    await capture(b, "social-chat-mobile");
    await a.reload();
    await expect(a.locator(".chat-list")).toContainText("bob");
    await a.locator(".chat-contact").filter({ hasText: "bob" }).first().click();
    await expect(a.locator(".chat-messages")).toContainText("Oui, à 9 heures.");
    await a
      .getByRole("button", { name: "Voir mon profil", exact: false })
      .first()
      .click();
    await a
      .getByRole("button", { name: "Modifier le profil", exact: true })
      .click();
    await a
      .getByRole("dialog")
      .getByLabel("Quelques mots sur votre pratique")
      .fill("Course à pied et entraînement en groupe.");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(a.locator(".profile-bio")).toHaveText(
      "Course à pied et entraînement en groupe.",
    );
    await a.reload();
    await expect(a.locator(".profile-bio")).toHaveText(
      "Course à pied et entraînement en groupe.",
    );
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#2467e8" },
    })
      .png()
      .toBuffer();
    await a.getByLabel("Changer la photo de profil").setInputFiles({
      name: "profile.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(a.locator(".profile-content .avatar")).toHaveAttribute(
      "src",
      /5013\/uploads\/profil/,
    );
    console.log("responsive");
    for (const width of [1440, 800, 390, 320]) {
      await a.setViewportSize({ width, height: 900 });
      for (const route of [
        "/home",
        "/trends",
        "/saved",
        "/likes",
        "/notification",
        "/message",
        "/profil",
      ]) {
        await a.goto(url + route);
        await expect(a.locator("h1")).toBeVisible();
        await check(a);
      }
      await a.goto(url + "/home");
      await check(a);
      await capture(a, `social-feed-${width}`);
      await a
        .getByRole("button", { name: "Options de la publication" })
        .click();
      await a.getByRole("button", { name: "Modifier", exact: true }).click();
      await expect(a.getByRole("dialog")).toBeVisible();
      await check(a);
      await a.keyboard.press("Escape");
      await expect(a.getByRole("dialog")).toHaveCount(0);
    }
    await a.goto(url + "/home");
    await a.route("**/api/post", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await a
      .getByLabel("Votre publication", { exact: true })
      .fill("Brouillon conservé");
    await a.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(a.locator(".composer [role=alert]")).toContainText(
      "connexion",
    );
    await expect(
      a.getByLabel("Votre publication", { exact: true }),
    ).toHaveValue("Brouillon conservé");
    await a.unroute("**/api/post");
    await a.getByLabel("Votre publication", { exact: true }).fill("");
    await a.getByRole("button", { name: "Options de la publication" }).click();
    await a.getByRole("button", { name: "Supprimer", exact: true }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();
    await expect(a.locator(".post-card")).toHaveCount(0);
    await a.reload();
    await expect(a.locator(".post-card")).toHaveCount(0);
    await a.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(
      a2.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    await expect(
      a2.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveCount(0);
    await a2.close();
    await expect(
      a.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    await a.reload();
    await expect(
      a.getByRole("heading", { name: "Content de vous revoir." }),
    ).toBeVisible();
    assert.deepEqual(errors, []);
    console.log(
      "E2E PASS : inscription/connexion, doubles soumissions post/commentaire/message, clés conservées après erreur réseau, conflit édition 2 onglets, likes/sauvegarde/reload/follow, messages 3 onglets HTTP/socket avec réponse perdue et rattrapage après coupure, bio/photo/reload, suppression/logout, 7 vues à 1440/800/390/320; restauration texte/photo/UUID, quotas, conflits brouillons, épingles privées 2 onglets, recherche accent-insensible, réponse tardive sans effacer une autre conversation, logout multi-onglets, clavier Escape/mouvement réduit, aucune erreur ou overflow.",
    );
  } catch (error) {
    console.error("Browser errors", errors);
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        await capture(page, "social-failure");
        console.error(
          page.url(),
          (await page.locator("body").innerText()).slice(0, 2000),
        );
      }
    }
    throw error;
  } finally {
    await browser.close();
    vite.kill("SIGTERM");
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await mongoose.disconnect();
    await database.stop();
    await rm(imageDirectory, { recursive: true, force: true });
    if (viteLog) console.error(viteLog);
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
