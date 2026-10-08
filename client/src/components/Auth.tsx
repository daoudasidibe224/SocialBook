import type { FormEvent } from "react";
import { sessionSchema } from "../../../shared/contracts";
import { useState } from "react";
import { ArrowUpRight, Activity, Users, MessageCircle } from "lucide-react";
import { api, errorMessage } from "../api";
import BlurText from "./ui/BlurText";
export default function Auth({
  onLogin,
}: {
  onLogin: (id: string) => Promise<void>;
}) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (register) {
        if (fields.password !== fields.confirm)
          throw new Error("Les mots de passe ne correspondent pas.");
        await api.post("/api/user/register", fields);
        setRegister(false);
        setSuccess("Votre compte est créé. Vous pouvez vous connecter.");
      } else {
        const { data } = await api.post(
          "/api/user/login",
          fields,
          sessionSchema,
        );
        await onLogin(sessionSchema.parse(data).user);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Activity />
          </span>
          Communauté sportive<span className="brand-dot">.</span>
        </a>
        <span className="eyebrow">Le sport se partage</span>
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <span className="label-chip">Votre communauté sportive</span>
          <h1>
            <BlurText text="Chaque séance a une histoire." />
          </h1>
          <p className="auth-lead">
            Partagez vos entraînements, encouragez vos amis et gardez le contact
            entre deux séances.
          </p>
          <div className="auth-visual" aria-hidden="true">
            <div className="track track-one" />
            <div className="track track-two" />
            <div className="track track-three" />
            <Activity className="visual-activity" />
            <span className="visual-note">On avance ensemble.</span>
            <span className="visual-mark">CS.</span>
          </div>
          <div className="auth-features">
            <span>
              <Activity size={18} /> Vos séances
            </span>
            <span>
              <Users size={18} /> Votre cercle
            </span>
            <span>
              <MessageCircle size={18} /> Vos échanges
            </span>
          </div>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="eyebrow">
            {register
              ? "Rejoignez le mouvement"
              : "Votre prochaine séance commence ici"}
          </span>
          <h2 id="auth-title">
            {register ? "Créer un compte" : "Content de vous revoir."}
          </h2>
          <p>
            {register
              ? "Quelques informations pour rejoindre la communauté."
              : "Connectez-vous pour retrouver votre communauté."}
          </p>
          <form onSubmit={submit} key={String(register)}>
            {register && (
              <label>
                Pseudo
                <input
                  name="pseudo"
                  autoComplete="nickname"
                  minLength={3}
                  maxLength={55}
                  required
                  placeholder="Votre pseudo"
                />
              </label>
            )}
            <label>
              Adresse e-mail
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                placeholder="vous@exemple.fr"
              />
            </label>
            <label>
              Mot de passe
              <div className="password-field">
                <input
                  aria-label="Mot de passe"
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 8 : undefined}
                  maxLength={72}
                  required
                  placeholder={
                    register ? "Au moins 8 caractères" : "Votre mot de passe"
                  }
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={
                    visible
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                >
                  {visible ? "Masquer" : "Voir"}
                </button>
              </div>
            </label>
            {register && (
              <label>
                Confirmer le mot de passe
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="form-success" role="status">
                {success}
              </p>
            )}
            <button disabled={busy} className="primary auth-submit">
              {busy
                ? "Un instant…"
                : register
                  ? "Créer mon compte"
                  : "Se connecter"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <div className="auth-switch">
            <span>{register ? "Déjà membre ?" : "Première visite ?"}</span>
            <button
              type="button"
              onClick={() => {
                setRegister(!register);
                setError("");
                setSuccess("");
              }}
            >
              {register ? "Se connecter" : "Créer un compte"}
            </button>
          </div>
          <p className="auth-footnote">
            Vos publications sont visibles par les membres. Vos conversations
            restent privées.
          </p>
        </section>
      </main>
      <footer className="auth-footer">
        Communauté sportive · Un espace pour partager votre pratique.
      </footer>
    </div>
  );
}
