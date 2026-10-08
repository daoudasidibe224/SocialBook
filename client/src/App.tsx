import { sessionEpoch, advanceSessionEpoch } from "./session";
import {
  navigation,
  Header,
  Sidebar,
  CommunityRail,
  MobileNavigation,
} from "./components/Shell";
import type { MouseEvent } from "react";
import { z } from "zod";
import {
  userSchema,
  memberSchema,
  postSchema,
  savedSchema,
  type User,
  type Member,
  type Post,
} from "../../shared/contracts";
import { useEffect, useRef, useState, lazy } from "react";
import { Activity, Bell, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { api, errorMessage, isUnauthorized } from "./api";
const Auth = lazy(() => import("./components/Auth"));
import { Avatar, Composer, PostCard } from "./components/Post";
const Profile = lazy(() => import("./components/Profile"));
const Messenger = lazy(() => import("./components/Messenger"));
import Modal from "./components/ui/Modal";
function readSaved(id: string): string[] {
  try {
    return savedSchema.parse(
      JSON.parse(localStorage.getItem(`trainingbook:saved:${id}`) || "[]"),
    );
  } catch {
    return [];
  }
}
export default function App() {
  const [route, setRoute] = useState(location.pathname + location.search);
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const path = route.split("?")[0];
  const currentUserRef = useRef(user);
  currentUserRef.current = user;
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const endingSession = useRef(false);
  function clearSession() {
    advanceSessionEpoch();
    setUser(null);
    setUsers([]);
    setPosts([]);
    setSaved([]);
    setError("");
    setSearchOpen(false);
    navigate("/");
  }
  useEffect(() => {
    const pop = () => setRoute(location.pathname + location.search);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(url: string) {
    history.pushState({}, "", url);
    setRoute(url);
    setSearch("");
    setMemberSearch("");
    setSearchOpen(false);
    window.scrollTo(0, 0);
  }
  function link(url: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        navigate(url);
      }
    };
  }
  async function refresh(id = user?._id) {
    if (!id) return;
    const epoch = sessionEpoch();
    const [me, members, feed] = await Promise.all([
      api.get(userSchema, `/api/user/${id}`),
      api.get(memberSchema.array(), "/api/user"),
      api.get(postSchema.array(), "/api/post"),
    ]);
    if (endingSession.current || epoch !== sessionEpoch()) return;
    setUser(me.data);
    setUsers(members.data);
    setPosts(feed.data);
    setSaved((current) =>
      current.filter((value) => feed.data.some((post) => post._id === value)),
    );
  }
  async function login(id: string) {
    const epoch = advanceSessionEpoch();
    endingSession.current = false;
    if (currentUserRef.current?._id !== id) {
      setUser(null);
      setUsers([]);
      setPosts([]);
      setSaved([]);
      setSearchOpen(false);
    }
    await refresh(id);
    if (epoch !== sessionEpoch() || endingSession.current) return;
    setSaved(readSaved(id));
    navigate("/home");
    sessionChannel.current?.postMessage("changed");
  }
  useEffect(() => {
    let active = true;
    async function init() {
      const epoch = sessionEpoch();
      try {
        const { data } = await api.get(z.string(), "/jwtid");
        if (active && epoch === sessionEpoch()) {
          await refresh(data);
          if (!active || epoch !== sessionEpoch() || endingSession.current)
            return;
          setSaved(readSaved(data));
          if (location.pathname === "/") navigate("/home");
        }
      } catch (err) {
        if (active && epoch === sessionEpoch() && !isUnauthorized(err))
          setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("community-sportive-session")
        : null;
    sessionChannel.current = channel;
    let checking = false,
      active = true;
    async function checkSession() {
      if (checking || !active || document.visibilityState === "hidden") return;
      checking = true;
      const epoch = sessionEpoch();
      try {
        const { data } = await api.get(z.string(), "/jwtid");
        if (active && epoch === sessionEpoch()) {
          endingSession.current = false;
          if (currentUserRef.current?._id !== data) await login(data);
        }
      } catch (error) {
        if (active && epoch === sessionEpoch() && isUnauthorized(error)) {
          endingSession.current = true;
          clearSession();
        }
      } finally {
        checking = false;
      }
    }
    function ended() {
      endingSession.current = true;
      clearSession();
    }
    function focused() {
      void checkSession();
    }
    window.addEventListener("community-session-ended", ended);
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === "ended") ended();
        else if (event.data === "changed") void checkSession();
      };
    const interval = setInterval(() => void checkSession(), 30000);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("community-session-ended", ended);
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", focused);
      channel?.close();
      sessionChannel.current = null;
    };
  }, []);
  useEffect(() => {
    document.title = `${user ? navigation.find((n) => n[0] === path)?.[1] || "Profil" : "Connexion"} · Communauté sportive`;
  }, [path, user]);
  function save(id: string) {
    if (!user) return;
    const next = saved.includes(id)
      ? saved.filter((value) => value !== id)
      : [...saved, id];
    try {
      localStorage.setItem(
        `trainingbook:saved:${user._id}`,
        JSON.stringify(next),
      );
      setSaved(next);
      setNotice(
        next.includes(id)
          ? "Publication sauvegardée sur cet appareil."
          : "Publication retirée des sauvegardes.",
      );
    } catch {
      setError("Les sauvegardes ne sont pas disponibles dans ce navigateur.");
    }
  }
  async function reload() {
    setRefreshing(true);
    setError("");
    try {
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }
  async function logout() {
    try {
      await api.post("/api/user/logout");
      endingSession.current = true;
      clearSession();
      sessionChannel.current?.postMessage("ended");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function deleteAccount() {
    if (!user) return;
    await api.request({ method: "delete", url: `/api/user/${user._id}` });
    try {
      localStorage.removeItem(`trainingbook:saved:${user._id}`);
    } catch {
      /* Le compte serveur est supprimé même si le stockage local est indisponible. */
    }
    endingSession.current = true;
    clearSession();
    sessionChannel.current?.postMessage("ended");
  }
  const openProfile = (id: string) => navigate(`/profil?user=${id}`);
  const profileId = new URLSearchParams(route.split("?")[1]).get("user");
  const person =
    users.find((u) => u._id === profileId) ||
    (profileId && profileId !== user?._id ? null : user);
  const profilePosts = posts.filter((p) => p.posterId === person?._id);
  const visible = posts
    .filter((p) =>
      path === "/saved"
        ? saved.includes(p._id)
        : path === "/likes"
          ? p.likers.includes(user?._id || "")
          : path === "/profil"
            ? p.posterId === person?._id
            : filter === "following"
              ? user?.following.includes(p.posterId) || p.posterId === user?._id
              : true,
    )
    .filter(
      (p) =>
        !search ||
        p.message
          .toLocaleLowerCase("fr")
          .includes(search.toLocaleLowerCase("fr")) ||
        users
          .find((u) => u._id === p.posterId)
          ?.pseudo.includes(search.toLowerCase()),
    );
  if (path === "/trends")
    visible.sort(
      (a, b) =>
        b.likers.length - a.likers.length ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const members = users.filter(
    (u) =>
      u._id !== user?._id &&
      (!search || u.pseudo.includes(search.toLowerCase())),
  );
  const suggestions = members
    .filter((u) => !user?.following.includes(u._id))
    .slice(0, 4);
  const interactions = posts
    .filter((p) => p.posterId === user?._id)
    .flatMap((p) => [
      ...p.comments
        .filter((c) => c.commenterId !== user?._id)
        .map((c) => ({
          key: c._id,
          title: `${c.commenterPseudo} a commenté votre publication`,
          text: c.text,
          date: c.timestamp,
        })),
      ...p.likers
        .filter((id) => id !== user?._id)
        .map((id) => ({
          key: `${p._id}-${id}`,
          title: `${users.find((u) => u._id === id)?.pseudo || "Un membre"} aime votre publication`,
          text: p.message || "Votre photo",
          date: 0,
        })),
    ])
    .sort((a, b) => (b.date || 0) - (a.date || 0));
  if (loading)
    return (
      <div className="loading-page" role="status">
        <Activity size={38} />
        <p>Chargement de votre espace…</p>
      </div>
    );
  if (!user)
    return (
      <>
        {error && (
          <div className="server-warning" role="alert">
            {error}
            <button onClick={() => location.reload()}>Réessayer</button>
          </div>
        )}
        <Auth onLogin={login} />
      </>
    );
  if (!person && path === "/profil")
    return (
      <main className="loading-page">
        <h1>Membre introuvable</h1>
        <a href="/home" onClick={link("/home")}>
          Retour à l’accueil
        </a>
      </main>
    );
  if (
    ![
      "/home",
      "/trends",
      "/saved",
      "/likes",
      "/message",
      "/notification",
      "/profil",
    ].includes(path)
  )
    return (
      <main className="loading-page">
        <h1>Page introuvable</h1>
        <a href="/home" onClick={link("/home")}>
          Retour à l’accueil
        </a>
      </main>
    );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Aller au contenu
      </a>
      <Header
        user={user}
        search={search}
        setSearch={setSearch}
        onSearch={() => {
          setMemberSearch("");
          setSearchOpen(true);
        }}
        openProfile={openProfile}
        logout={logout}
        link={link}
      />
      <div className="app-layout">
        <Sidebar
          user={user}
          path={path}
          savedCount={saved.length}
          openProfile={openProfile}
          link={link}
        />
        <main
          id="main"
          className={path === "/message" ? "content content-wide" : "content"}
        >
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {path === "/home"
                  ? "Votre communauté, au quotidien"
                  : path === "/trends"
                    ? "De nouvelles rencontres sportives"
                    : "Votre espace Communauté sportive"}
              </span>
              <h1>{navigation.find((n) => n[0] === path)?.[1] || "Profil"}</h1>
            </div>
            <button
              className="icon-button"
              aria-label="Actualiser"
              disabled={refreshing}
              onClick={reload}
            >
              <RefreshCw size={19} className={refreshing ? "spin" : ""} />
            </button>
          </div>
          {error && (
            <div className="feedback error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Fermer le message"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="feedback" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Fermer le message"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {path === "/message" ? (
            <Messenger key={user._id + route} user={user} users={users} />
          ) : path === "/notification" ? (
            <>
              <p className="section-description">
                Les réactions à vos publications et les membres qui vous
                suivent.
              </p>
              <section className="card activity-list">
                {interactions.length ? (
                  interactions.map((item) => (
                    <div className="activity-item" key={item.key}>
                      <Bell size={20} />
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <Bell size={32} />
                    <h2>Le début d’une communauté.</h2>
                    <p>Les réactions à vos publications apparaîtront ici.</p>
                  </div>
                )}
              </section>
              <section className="card activity-list">
                <h2>Vos abonnés</h2>
                {users
                  .filter((u) => user.followers.includes(u._id))
                  .map((u) => (
                    <button
                      className="member-row"
                      key={u._id}
                      onClick={() => openProfile(u._id)}
                    >
                      <Avatar user={u} />
                      <span>{u.pseudo}</span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                {user.followers.length === 0 && (
                  <p className="muted">Vous n’avez pas encore d’abonné.</p>
                )}
              </section>
            </>
          ) : (
            <>
              {path === "/home" && (
                <>
                  <div className="welcome-banner">
                    <div>
                      <span className="eyebrow">Ensemble, on va plus loin</span>
                      <h2>Une bonne séance mérite d’être partagée.</h2>
                      <p>
                        Votre prochaine inspiration est peut-être juste ici.
                      </p>
                    </div>
                    <Activity size={80} aria-hidden="true" />
                  </div>
                  <Composer
                    key={`composer:${user._id}`}
                    user={user}
                    onPublish={async () => {
                      await refresh();
                      setNotice("Votre publication est en ligne.");
                    }}
                  />
                  <div
                    className="feed-tabs"
                    aria-label="Filtrer les publications"
                  >
                    <button
                      className={filter === "all" ? "selected" : ""}
                      aria-pressed={filter === "all"}
                      onClick={() => setFilter("all")}
                    >
                      La communauté
                    </button>
                    <button
                      className={filter === "following" ? "selected" : ""}
                      aria-pressed={filter === "following"}
                      onClick={() => setFilter("following")}
                    >
                      Mes abonnements
                    </button>
                  </div>
                </>
              )}
              {path === "/profil" && person && (
                <>
                  <Profile
                    key={person._id}
                    person={person}
                    user={user}
                    users={users}
                    posts={profilePosts}
                    refresh={refresh}
                    openProfile={openProfile}
                    navigate={navigate}
                    deleteAccount={deleteAccount}
                  />
                  {person._id === user._id && (
                    <Composer
                      key={`composer:${user._id}`}
                      user={user}
                      onPublish={refresh}
                    />
                  )}
                </>
              )}
              {path === "/trends" && (
                <>
                  <p className="section-description">
                    Découvrez les membres et les publications les plus
                    appréciées.
                  </p>
                  <section className="card discover-members">
                    <h2>Rencontrez la communauté</h2>
                    <div>
                      {members.slice(0, 12).map((u) => (
                        <button
                          className="member-row"
                          key={u._id}
                          onClick={() => openProfile(u._id)}
                        >
                          <Avatar user={u} />
                          <span>
                            <strong>{u.pseudo}</strong>
                            <small>{u.followers.length} abonnés</small>
                          </span>
                          <ArrowUpRight size={18} />
                        </button>
                      ))}
                      {members.length === 0 && (
                        <p className="muted">Aucun membre à afficher.</p>
                      )}
                    </div>
                  </section>
                  <h2 className="section-title">
                    Les publications à découvrir
                  </h2>
                </>
              )}
              {path === "/saved" && (
                <p className="section-description">
                  Vos publications à retrouver. Les sauvegardes restent sur cet
                  appareil.
                </p>
              )}
              {path === "/likes" && (
                <p className="section-description">
                  Les publications que vous avez aimées.
                </p>
              )}
              {search && (
                <p className="search-summary">
                  {visible.length} publication(s) pour « {search} »
                </p>
              )}
              {visible.map((post) => (
                <PostCard
                  key={post._id}
                  post={post}
                  user={user}
                  users={users}
                  saved={saved.includes(post._id)}
                  onSave={save}
                  onUpdate={refresh}
                  openProfile={openProfile}
                />
              ))}
              {visible.length === 0 && (
                <div className="card empty-state">
                  <Activity size={36} />
                  <h2>
                    {path === "/saved"
                      ? "Gardez vos inspirations à portée de main."
                      : "Le terrain est ouvert."}
                  </h2>
                  <p>
                    {search
                      ? "Aucune publication ne correspond à cette recherche."
                      : path === "/saved"
                        ? "Utilisez le marque-page sous une publication pour la retrouver ici."
                        : path === "/likes"
                          ? "Les publications que vous aimez apparaîtront ici."
                          : "Partagez une séance ou découvrez des membres à suivre."}
                  </p>
                  {path !== "/trends" && (
                    <a
                      className="secondary"
                      href="/trends"
                      onClick={link("/trends")}
                    >
                      Explorer la communauté
                      <ArrowUpRight size={16} />
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </main>
        {path !== "/message" && (
          <CommunityRail
            user={user}
            suggestions={suggestions}
            openProfile={openProfile}
            link={link}
          />
        )}
      </div>
      <MobileNavigation path={path} link={link} />
      {searchOpen && (
        <Modal
          title="Rechercher un membre"
          onClose={() => setSearchOpen(false)}
        >
          <label>
            Nom du membre
            <input
              autoFocus
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Entrez un pseudo"
            />
          </label>
          {members
            .filter((u) => u.pseudo.includes(memberSearch.toLowerCase()))
            .map((u) => (
              <button
                key={u._id}
                className="member-row"
                onClick={() => openProfile(u._id)}
              >
                <Avatar user={u} />
                <span>{u.pseudo}</span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          {members.length === 0 && (
            <p className="muted">Aucun membre trouvé.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
