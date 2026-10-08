import type { FormEvent } from "react";
import {
  conversationSchema,
  messageSchema,
  type Member,
  type User,
  type Conversation,
  type Message,
} from "../../../shared/contracts";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { io } from "socket.io-client";
import { API_URL, api, errorMessage, dateLabel } from "../api";
import { Avatar } from "./Post";
export default function Messenger({
  user,
  users,
}: {
  user: User;
  users: Member[];
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [incoming, setIncoming] = useState<Message | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const friendId = new URLSearchParams(location.search).get("with");
  useEffect(() => {
    let active = true;
    api
      .get(conversationSchema.array(), `/api/conversations/${user._id}`)
      .then((res) => {
        if (active) setConversations(res.data);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      });
    const socket = io(API_URL, { withCredentials: true });
    socket.on("getMessage", (payload: unknown) => {
      const parsed = messageSchema.safeParse(payload);
      if (parsed.success) setIncoming(parsed.data);
      else
        setError("Un message reçu est invalide. Actualisez la conversation.");
    });
    socket.on("connect_error", () => {
      if (active)
        setError(
          "La connexion en direct est interrompue. Les messages restent accessibles en rouvrant la conversation.",
        );
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [user._id]);
  useEffect(() => {
    if (!incoming) return;
    if (current?._id === incoming.conversationId)
      setMessages((previous) =>
        previous.some((m) => m._id === incoming._id)
          ? previous
          : [...previous, incoming],
      );
    api
      .get(conversationSchema.array(), `/api/conversations/${user._id}`)
      .then((res) => setConversations(res.data))
      .catch(() => {});
  }, [incoming, current?._id, user._id]);
  useEffect(() => {
    if (!current) return;
    let active = true;
    setLoading(true);
    setMessages([]);
    setDraft("");
    api
      .get(messageSchema.array(), `/api/messages/${current._id}`)
      .then((res) => {
        if (active)
          setMessages((previous) =>
            [
              ...res.data,
              ...previous.filter(
                (message) =>
                  !res.data.some((existing) => existing._id === message._id),
              ),
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          );
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [current?._id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  useEffect(() => {
    if (friendId && friendId !== user._id) start(friendId);
  }, [friendId]);
  async function start(receiverId: string) {
    setError("");
    try {
      const { data } = await api.post(
        "/api/conversations",
        { receiverId },
        conversationSchema,
      );
      if (!data) return;
      setCurrent(data);
      setConversations((previous) =>
        previous.some((c) => c._id === data._id)
          ? previous
          : [data, ...previous],
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim() || !current) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        "/api/messages",
        { conversationId: current._id, text: draft },
        messageSchema,
      );
      if (!data) return;
      setMessages((previous) => [...previous, data]);
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const friend = users.find(
    (u) => current?.members.includes(u._id) && u._id !== user._id,
  );
  const contacts = users.filter((u) => user.following.includes(u._id));
  return (
    <section
      className={`card messenger ${current ? "chat-open" : ""}`}
      aria-label="Messagerie"
    >
      <aside className="chat-list">
        <h2>Conversations</h2>
        {conversations.length ? (
          conversations.map((c) => {
            const person = users.find(
              (u) => c.members.includes(u._id) && u._id !== user._id,
            );
            return (
              <button
                key={c._id}
                className={`chat-contact ${current?._id === c._id ? "selected" : ""}`}
                onClick={() => setCurrent(c)}
              >
                <Avatar user={person} />
                <span>
                  {person?.pseudo || "Membre supprimé"}
                  <small>Ouvrir la conversation</small>
                </span>
              </button>
            );
          })
        ) : (
          <p className="muted chat-hint">Vos conversations apparaîtront ici.</p>
        )}
        <h3>Vos contacts</h3>
        {contacts.length ? (
          contacts.map((person) => (
            <button
              key={person._id}
              className="chat-contact"
              onClick={() => start(person._id)}
            >
              <Avatar user={person} />
              <span>
                {person.pseudo}
                <small>Écrire un message</small>
              </span>
            </button>
          ))
        ) : (
          <p className="muted chat-hint">
            Suivez des membres depuis Explorer pour les retrouver ici.
          </p>
        )}
      </aside>
      <div className="chat-main">
        {current ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button chat-back"
                aria-label="Retour aux conversations"
                onClick={() => setCurrent(null)}
              >
                <ArrowLeft size={20} />
              </button>
              <Avatar user={friend} />
              <strong>{friend?.pseudo || "Conversation"}</strong>
              <span className="label-chip">Privé</span>
            </header>
            <div className="chat-messages" aria-live="polite">
              {loading ? (
                <p className="muted">Chargement des messages…</p>
              ) : messages.length === 0 ? (
                <p className="muted">La conversation commence ici.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m._id}
                    className={`message ${m.sender === user._id ? "own" : ""}`}
                  >
                    <p>{m.text}</p>
                    <time dateTime={m.createdAt}>{dateLabel(m.createdAt)}</time>
                  </div>
                ))
              )}
              <div ref={end} />
            </div>
            <form className="chat-compose" onSubmit={send}>
              <label className="sr-only" htmlFor="chat-message">
                Votre message
              </label>
              <input
                id="chat-message"
                placeholder="Écrivez votre message…"
                value={draft}
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
                required
              />
              <button
                className="primary"
                aria-label="Envoyer le message"
                disabled={busy || !draft.trim() || loading}
              >
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state">
            <MessageCircle size={38} />
            <h2>Gardez le contact.</h2>
            <p>Ouvrez une conversation ou choisissez un contact.</p>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
