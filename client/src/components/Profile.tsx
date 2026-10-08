import type { Member, User, Post } from "../../../shared/contracts";
import { useState } from "react";
import { Camera, Pencil, MessageCircle, UserPlus, Check } from "lucide-react";
import { api, errorMessage } from "../api";
import { Avatar } from "./Post";
import Modal from "./ui/Modal";
export default function Profile({
  person,
  user,
  users,
  posts,
  refresh,
  openProfile,
  navigate,
  deleteAccount,
}: {
  person: Member;
  user: User;
  users: Member[];
  posts: Post[];
  refresh: () => Promise<void>;
  openProfile: (id: string) => void;
  navigate: (url: string) => void;
  deleteAccount: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [edit, setEdit] = useState(false);
  const [bio, setBio] = useState(person.bio || "");
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = person._id === user._id;
  const following = user.following.includes(person._id);
  async function change(action: () => Promise<unknown>, refreshAfter = true) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (refreshAfter) await refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card profile-card">
      <div className="profile-cover">
        <span>Le sport se partage.</span>
      </div>
      <div className="profile-content">
        <Avatar user={person} size="avatar-large" />
        <div className="profile-top">
          <div>
            <span className="eyebrow">Membre Communauté sportive</span>
            <h2>{person.pseudo}</h2>
          </div>
          {mine ? (
            <button
              className="secondary"
              onClick={() => {
                setBio(person.bio || "");
                setEdit(true);
              }}
            >
              <Pencil size={16} /> Modifier le profil
            </button>
          ) : (
            <div className="profile-buttons">
              <button
                disabled={busy}
                className={following ? "secondary" : "primary"}
                onClick={() =>
                  change(() =>
                    api.patch(
                      `/api/user/${following ? "unfollow" : "follow"}/${user._id}`,
                      following
                        ? { idToUnfollow: person._id }
                        : { idToFollow: person._id },
                    ),
                  )
                }
              >
                {following ? <Check size={16} /> : <UserPlus size={16} />}
                {following ? "Suivi" : "Suivre"}
              </button>
              <button
                className="secondary"
                onClick={() => navigate(`/message?with=${person._id}`)}
              >
                <MessageCircle size={16} /> Message
              </button>
            </div>
          )}
        </div>
        <p className="profile-bio">
          {person.bio || "Ce membre n’a pas encore renseigné sa bio."}
        </p>
        <div className="profile-stats">
          <span>
            <strong>{posts.length}</strong> publications
          </span>
          <button onClick={() => setList("followers")}>
            <strong>{person.followers.length}</strong> abonnés
          </button>
          <button onClick={() => setList("following")}>
            <strong>{person.following.length}</strong> abonnements
          </button>
        </div>
        {mine && (
          <label className="photo-button profile-upload">
            <Camera size={17} />
            {busy ? "Enregistrement…" : "Changer la photo"}
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy}
              aria-label="Changer la photo de profil"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (
                  !["image/jpeg", "image/png"].includes(file.type) ||
                  file.size > 500000
                ) {
                  setError(
                    "Choisissez une photo JPEG ou PNG de 500 Ko maximum.",
                  );
                  return;
                }
                const data = new FormData();
                data.append("userId", user._id);
                data.append("file", file);
                change(() => api.post("/api/user/upload", data));
              }}
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {mine && (
        <div className="account-settings">
          <h3>Votre compte</h3>
          <p>
            Supprimer votre compte efface vos publications, commentaires et
            conversations privées.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setError("");
              setConfirmDelete(true);
            }}
          >
            Supprimer mon compte
          </button>
        </div>
      )}
      {confirmDelete && (
        <Modal
          title="Supprimer votre compte ?"
          onClose={() => setConfirmDelete(false)}
        >
          <p>
            Cette action efface votre compte et vos échanges. Vous ne pourrez
            pas les récupérer.
          </p>
          {error && (
            <p className="form-error" role="alert">
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
              onClick={() => change(deleteAccount, false)}
            >
              Supprimer mon compte
            </button>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title="Modifier ma bio" onClose={() => setEdit(false)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change(() => api.put(`/api/user/${user._id}`, { bio })))
                setEdit(false);
            }}
          >
            <label>
              Quelques mots sur votre pratique
              <textarea
                rows={4}
                maxLength={1024}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                autoFocus
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Enregistrer
            </button>
          </form>
        </Modal>
      )}
      {list && (
        <Modal
          title={list === "followers" ? "Abonnés" : "Abonnements"}
          onClose={() => setList(null)}
        >
          {users
            .filter((u) => person[list].includes(u._id))
            .map((u) => (
              <button
                className="member-row"
                key={u._id}
                onClick={() => {
                  setList(null);
                  openProfile(u._id);
                }}
              >
                <Avatar user={u} />
                <span>{u.pseudo}</span>
              </button>
            ))}
          {person[list].length === 0 && (
            <p className="muted">Aucun membre pour le moment.</p>
          )}
        </Modal>
      )}
    </section>
  );
}
