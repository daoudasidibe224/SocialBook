import type { ChangeEvent, FormEvent } from "react";
import type { Member, User, Post } from "../../../shared/contracts";
import { useEffect, useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  Bookmark,
  ImagePlus,
  Send,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { api, errorMessage, imageUrl, dateLabel } from "../api";
import { usePersistentDraft } from "../usePersistentDraft";
import DraftNotice from "./DraftNotice";
import Modal from "./ui/Modal";
export function Avatar({
  user,
  size = "",
  onClick,
}: {
  user?: Member;
  size?: string;
  onClick?: () => void;
}) {
  const img = (
    <img
      className={`avatar ${size}`}
      src={imageUrl(user?.picture)}
      alt=""
      loading="lazy"
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = "/uploads/profil/random-user.png";
      }}
    />
  );
  return onClick ? (
    <button
      type="button"
      className="avatar-button"
      aria-label={`Voir le profil de ${user?.pseudo || "ce membre"}`}
      onClick={onClick}
    >
      {img}
    </button>
  ) : (
    img
  );
}
export function Composer({
  user,
  onPublish,
}: {
  user: User;
  onPublish: () => Promise<void>;
}) {
  const draft = usePersistentDraft({ kind: "post", userId: user._id });
  const message = draft.text,
    file = draft.photo,
    setMessage = draft.setText,
    setFile = draft.setPhoto;
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function select(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    setError("");
    if (!image) return;
    if (
      !["image/jpeg", "image/png"].includes(image.type) ||
      image.size > 500000
    ) {
      setError("Choisissez une photo JPEG ou PNG de 500 Ko maximum.");
      event.target.value = "";
      return;
    }
    setFile(image);
  }
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || (!message.trim() && !file)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const snapshot = await draft.prepare();
      const data = new FormData();
      data.append("message", snapshot.text);
      data.append("posterId", user._id);
      data.append("requestId", snapshot.requestId);
      if (snapshot.photo) data.append("file", snapshot.photo);
      await api.post("/api/post", data);
      await onPublish();
      await draft.acknowledge(snapshot);
      if (input.current) input.current.value = "";
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="card composer" onSubmit={publish}>
      <div className="composer-top">
        <Avatar user={user} />
        <div>
          <strong>À vous de jouer, {user.pseudo}.</strong>
          <p>Une séance, une réussite, une question ?</p>
        </div>
      </div>
      <label className="sr-only" htmlFor="new-post">
        Votre publication
      </label>
      <textarea
        id="new-post"
        disabled={busy}
        placeholder="Racontez votre dernière séance…"
        maxLength={500}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
        }}
        rows={3}
      />
      {preview && (
        <div className="image-preview">
          <img src={preview} alt="Photo à publier" />
          <button
            type="button"
            className="icon-button"
            aria-label="Retirer la photo"
            disabled={busy}
            onClick={() => {
              setFile(null);
              if (input.current) input.current.value = "";
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <DraftNotice draft={draft} busy={busy} />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="composer-footer">
        <label className="photo-button">
          <ImagePlus size={19} /> Ajouter une photo
          <input
            ref={input}
            disabled={busy}
            type="file"
            accept="image/jpeg,image/png"
            onChange={select}
            aria-label="Ajouter une photo"
          />
        </label>
        <span className="char-count">{message.length}/500</span>
        <button
          className="primary"
          disabled={busy || !draft.ready || (!message.trim() && !file)}
        >
          {busy ? "Publication…" : "Publier"}
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}
export function PostCard({
  post,
  user,
  users,
  saved,
  onSave,
  onUpdate,
  openProfile,
}: {
  post: Post;
  user: User;
  users: Member[];
  saved: boolean;
  onSave: (id: string) => void;
  onUpdate: () => Promise<void>;
  openProfile: (id: string) => void;
}) {
  const author = users.find((u) => u._id === post.posterId);
  const [comments, setComments] = useState(false);
  const [comment, setComment] = useState("");
  const [edit, setEdit] = useState<{
    id?: string;
    text: string;
    original: string;
  } | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);
  const commentSubmission = useRef<string | null>(null);
  const liked = post.likers.includes(user._id);
  async function action(
    method: "patch" | "put" | "delete",
    url: string,
    data?: Record<string, string>,
  ) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await api.request({ method, url, data });
      await onUpdate();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="card post-card">
      <header className="post-head">
        <Avatar user={author} onClick={() => openProfile(post.posterId)} />
        <div className="post-author">
          <button
            className="text-button"
            onClick={() => openProfile(post.posterId)}
          >
            {author?.pseudo || "Membre supprimé"}
          </button>
          <time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time>
        </div>
        {post.posterId === user._id && (
          <div className="post-menu">
            <button
              type="button"
              aria-label="Options de la publication"
              aria-expanded={menu}
              className="icon-button"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={20} />
            </button>
            {menu && (
              <div className="menu">
                <button
                  onClick={() => {
                    setEdit({ text: post.message, original: post.message });
                    setMenu(false);
                  }}
                >
                  <Pencil size={16} /> Modifier
                </button>
                <button
                  onClick={() => {
                    setConfirmDelete(true);
                    setMenu(false);
                  }}
                >
                  <Trash2 size={16} /> Supprimer
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {post.message && <p className="post-message">{post.message}</p>}
      {post.picture && (
        <img
          className="post-image"
          src={imageUrl(post.picture)}
          alt={`Photo partagée par ${author?.pseudo || "un membre"}`}
          loading="lazy"
        />
      )}

      <div className="post-actions">
        <button
          type="button"
          disabled={busy}
          className={liked ? "liked" : ""}
          aria-pressed={liked}
          aria-label={liked ? "Retirer le j’aime" : "Aimer la publication"}
          onClick={() =>
            action(
              "patch",
              `/api/post/${liked ? "unlike" : "like"}-post/${post._id}`,
              { id: user._id },
            )
          }
        >
          <Heart size={19} fill={liked ? "currentColor" : "none"} />
          {post.likers.length}
          <span>J’aime</span>
        </button>
        <button
          type="button"
          aria-label="Commentaires"
          aria-expanded={comments}
          onClick={() => setComments(!comments)}
        >
          <MessageCircle size={19} />
          {post.comments.length}
          <span>Commentaires</span>
        </button>
        <button
          type="button"
          className="save-button"
          aria-label={
            saved ? "Retirer des sauvegardes" : "Sauvegarder la publication"
          }
          aria-pressed={saved}
          onClick={() => onSave(post._id)}
        >
          <Bookmark size={19} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      {comments && (
        <div className="comments">
          {post.comments.length === 0 && (
            <p className="muted">Soyez le premier à réagir.</p>
          )}
          {post.comments.map((c) => (
            <div key={c._id} className="comment">
              <div>
                <strong>{c.commenterPseudo}</strong>
                <p>{c.text}</p>
              </div>
              {c.commenterId === user._id && (
                <>
                  <button
                    className="icon-button"
                    aria-label="Modifier le commentaire"
                    onClick={() =>
                      setEdit({ id: c._id, text: c.text, original: c.text })
                    }
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label="Supprimer le commentaire"
                    onClick={() =>
                      action(
                        "patch",
                        `/api/post/delete-comment-post/${post._id}`,
                        { commentId: c._id },
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          ))}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (inFlight.current || !comment.trim()) return;
              commentSubmission.current ??= crypto.randomUUID();
              if (
                await action("patch", `/api/post/comment-post/${post._id}`, {
                  text: comment,
                  commenterId: user._id,
                  requestId: commentSubmission.current,
                })
              ) {
                setComment("");
                commentSubmission.current = null;
              }
            }}
          >
            <label className="sr-only" htmlFor={`comment-${post._id}`}>
              Votre commentaire
            </label>
            <input
              id={`comment-${post._id}`}
              disabled={busy}
              value={comment}
              onChange={(event) => {
                commentSubmission.current = null;
                setComment(event.target.value);
              }}
              placeholder="Encouragez, échangez…"
              maxLength={500}
              required
            />
            <button
              className="icon-button"
              aria-label="Envoyer le commentaire"
              disabled={busy || !comment.trim()}
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {edit && (
        <Modal
          title={
            edit.id ? "Modifier le commentaire" : "Modifier la publication"
          }
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = edit.id
                ? await action(
                    "patch",
                    `/api/post/edit-comment-post/${post._id}`,
                    {
                      commentId: edit.id,
                      text: edit.text,
                      expectedText: edit.original,
                    },
                  )
                : await action("put", `/api/post/${post._id}`, {
                    message: edit.text,
                    expectedMessage: edit.original,
                  });
              if (ok) setEdit(null);
            }}
          >
            <label>
              Texte
              <textarea
                value={edit.text}
                disabled={busy}
                maxLength={500}
                onChange={(event) =>
                  setEdit({ ...edit, text: event.target.value })
                }
                required={Boolean(edit.id) || !post.picture}
                rows={4}
                autoFocus
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Enregistrer
            </button>
          </form>
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title="Supprimer cette publication ?"
          onClose={() => setConfirmDelete(false)}
        >
          <p>La publication et ses commentaires seront supprimés.</p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Annuler
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => action("delete", `/api/post/${post._id}`)}
            >
              Supprimer
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
