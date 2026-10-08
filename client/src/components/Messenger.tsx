import { usePersistentDraft } from "../usePersistentDraft";
import DraftNotice from "./DraftNotice";
import { mergeMessages } from "../messages";
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
import { ArrowLeft, MessageCircle, Send, Pin, PinOff, X } from "lucide-react";
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
  const draft = usePersistentDraft(
    current
      ? { kind: "message", userId: user._id, conversationId: current._id }
      : null,
  );
  const [search, setSearch] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const pinning = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const currentRef = useRef<Conversation | null>(null);
  currentRef.current = current;
  const sending = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const friendId = new URLSearchParams(location.search).get("with");
  useEffect(() => {
    let active = true;
    api
      .get(conversationSchema.array(), `/api/conversations/${user._id}`)
      .then((res) => {
        if (active) {
          setConversations(res.data);
          setCurrent((previous) =>
            previous
              ? (res.data.find((c) => c._id === previous._id) ?? previous)
              : null,
          );
        }
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      });
    async function syncConversations() {
      try {
        const res = await api.get(
          conversationSchema.array(),
          `/api/conversations/${user._id}`,
        );
        if (active) {
          setConversations(res.data);
          setCurrent((previous) =>
            previous
              ? (res.data.find((c) => c._id === previous._id) ?? previous)
              : null,
          );
        }
      } catch (err) {
        if (active) setError(errorMessage(err));
      }
    }
    async function catchUp() {
      const conversation = currentRef.current;
      await syncConversations();
      if (!conversation) return;
      try {
        const res = await api.get(
          messageSchema.array(),
          `/api/messages/${conversation._id}`,
        );
        if (active && currentRef.current?._id === conversation._id)
          setMessages((previous) => mergeMessages(previous, res.data));
      } catch (err) {
        if (active) setError(errorMessage(err));
      }
    }
    const socket = io(API_URL, { withCredentials: true });
    socket.on("sessionReady", () => {
      if (active) {
        setError("");
        void catchUp();
      }
    });
    socket.on("conversationsChanged", () => void syncConversations());
    socket.on("getMessage", (payload: unknown) => {
      if (!active) return;
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) {
        setError("Un message reçu est invalide. Actualisez la conversation.");
        return;
      }
      if (currentRef.current?._id === parsed.data.conversationId)
        setMessages((previous) => mergeMessages(previous, [parsed.data]));
      void syncConversations();
    });
    socket.on("connect_error", () => {
      if (active)
        setError(
          "La connexion en direct est interrompue. Les messages seront rattrapés à la reconnexion.",
        );
    });
    socket.on("disconnect", (reason) => {
      if (active && reason === "io server disconnect") {
        window.dispatchEvent(new Event("community-session-ended"));
        setError(
          "Votre session a pris fin. Reconnectez-vous pour utiliser la messagerie.",
        );
      }
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [user._id]);
  useEffect(() => {
    if (!current) return;
    let active = true;
    setLoading(true);
    setMessages([]);
    setSearch("");
    api
      .get(messageSchema.array(), `/api/messages/${current._id}`)
      .then((res) => {
        if (active)
          setMessages((previous) => mergeMessages(previous, res.data));
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
    if (sending.current || !draft.text.trim() || !current || loading) return;
    const conversationId = current._id;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const snapshot = await draft.prepare();
      const { data } = await api.post(
        "/api/messages",
        {
          conversationId,
          text: snapshot.text.trim(),
          requestId: snapshot.requestId,
        },
        messageSchema,
      );
      if (!data) throw new Error("Le message n’a pas été confirmé. Réessayez.");
      if (currentRef.current?._id === conversationId) {
        setMessages((previous) => mergeMessages(previous, [data]));
      }
      await draft.acknowledge(snapshot);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function togglePin() {
    if (!current || pinning.current) return;
    const id = current._id;
    pinning.current = true;
    setPinBusy(true);
    setError("");
    try {
      const response = await api.patch(`/api/conversations/${id}/pin`, {
        pinned: !current.pinned,
      });
      const data = conversationSchema.parse(response.data);
      if (data) {
        setConversations((previous) =>
          previous.map((c) => (c._id === id ? data : c)),
        );
        setCurrent((previous) => (previous?._id === id ? data : previous));
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pinning.current = false;
      setPinBusy(false);
    }
  }
  const normalized = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr");
  const visibleMessages = messages.filter((message) =>
    normalized(message.text).includes(normalized(search.trim())),
  );
  const orderedConversations = [...conversations].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a._id.localeCompare(b._id),
  );
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
          orderedConversations.map((c) => {
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
                  <small>
                    {c.pinned ? "Épinglée" : "Ouvrir la conversation"}
                  </small>
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
              <button
                type="button"
                className="icon-button"
                disabled={pinBusy}
                aria-pressed={current.pinned}
                aria-label={
                  current.pinned
                    ? "Désépingler la conversation"
                    : "Épingler la conversation"
                }
                onClick={() => void togglePin()}
              >
                {current.pinned ? <PinOff size={18} /> : <Pin size={18} />}
              </button>
              <span className="label-chip">Privé</span>
            </header>
            <div className="chat-compose">
              <label className="sr-only" htmlFor="message-search">
                Rechercher dans cette conversation
              </label>
              <input
                id="message-search"
                type="text"
                role="searchbox"
                inputMode="search"
                placeholder="Rechercher dans cette conversation"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Effacer la recherche"
                  onClick={() => setSearch("")}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="chat-messages" aria-live="polite">
              {loading ? (
                <p className="muted">Chargement des messages…</p>
              ) : visibleMessages.length === 0 ? (
                <p className="muted">
                  {search
                    ? "Aucun message ne correspond à votre recherche."
                    : "La conversation commence ici."}
                </p>
              ) : (
                visibleMessages.map((m) => (
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
            <DraftNotice draft={draft} busy={busy} />
            <form className="chat-compose" onSubmit={send}>
              <label className="sr-only" htmlFor="chat-message">
                Votre message
              </label>
              <input
                id="chat-message"
                placeholder="Écrivez votre message…"
                value={draft.text}
                maxLength={2000}
                onChange={(event) => draft.setText(event.target.value)}
                required
              />
              <button
                className="primary"
                aria-label="Envoyer le message"
                disabled={busy || !draft.ready || !draft.text.trim() || loading}
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
