import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  House,
  Compass,
  Bookmark,
  Heart,
  MessageCircle,
  Bell,
  Search,
  LogOut,
  ArrowUpRight,
  Users,
  ChevronRight,
} from "lucide-react";
import type { User, Member } from "../../../shared/contracts";
import { Avatar } from "./Post";
type Link = (url: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
export const navigation: [string, string, LucideIcon][] = [
  ["/home", "Fil d’actualité", House],
  ["/trends", "Explorer", Compass],
  ["/saved", "Sauvegardés", Bookmark],
  ["/likes", "J’aime", Heart],
  ["/message", "Messages", MessageCircle],
  ["/notification", "Activité", Bell],
];

export function Header({
  user,
  search,
  setSearch,
  onSearch,
  openProfile,
  logout,
  link,
}: {
  user: User;
  search: string;
  setSearch: (value: string) => void;
  onSearch: () => void;
  openProfile: (id: string) => void;
  logout: () => Promise<void>;
  link: Link;
}) {
  return (
    <header className="app-header">
      <a className="brand" href="/home" onClick={link("/home")}>
        <span className="brand-icon">
          <Activity size={24} />
        </span>
        Communauté sportive<span className="brand-dot">.</span>
      </a>
      <label className="global-search">
        <Search size={19} />
        <input
          aria-label="Rechercher des publications ou des membres"
          placeholder="Rechercher une séance, un membre…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="header-right">
        <button
          className="icon-button mobile-search"
          aria-label="Rechercher des membres"
          onClick={onSearch}
        >
          <Search size={20} />
        </button>
        <button
          className="header-profile"
          onClick={() => openProfile(user._id)}
        >
          <Avatar user={user} />
          <span>{user.pseudo}</span>
        </button>
        <button
          className="icon-button"
          aria-label="Se déconnecter"
          onClick={logout}
        >
          <LogOut size={19} />
        </button>
      </div>
    </header>
  );
}
export function Sidebar({
  user,
  path,
  savedCount,
  openProfile,
  link,
}: {
  user: User;
  path: string;
  savedCount: number;
  openProfile: (id: string) => void;
  link: Link;
}) {
  return (
    <aside className="sidebar">
      <span className="eyebrow sidebar-label">Votre espace</span>
      <nav aria-label="Navigation principale">
        {navigation.map(([url, label, Icon]) => (
          <a
            key={url}
            href={url}
            onClick={link(url)}
            className={path === url ? "nav-link active" : "nav-link"}
            aria-current={path === url ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
            {url === "/saved" && savedCount > 0 && (
              <span className="nav-count">{savedCount}</span>
            )}
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button onClick={() => openProfile(user._id)}>
          <Avatar user={user} />
          <span>
            <strong>{user.pseudo}</strong>
            <small>Voir mon profil</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <p>Communauté sportive · Le sport se partage.</p>
      </div>
    </aside>
  );
}
export function CommunityRail({
  user,
  suggestions,
  openProfile,
  link,
}: {
  user: User;
  suggestions: Member[];
  openProfile: (id: string) => void;
  link: Link;
}) {
  return (
    <aside className="right-rail">
      <section className="card rail-profile">
        <Avatar user={user} size="avatar-medium" />
        <h2>{user.pseudo}</h2>
        <p>{user.bio || "Chaque séance compte."}</p>
        <div>
          <span>
            <strong>{user.following.length}</strong> abonnements
          </span>
          <span>
            <strong>{user.followers.length}</strong> abonnés
          </span>
        </div>
        <button className="text-button" onClick={() => openProfile(user._id)}>
          Voir mon profil <ArrowUpRight size={15} />
        </button>
      </section>
      <section className="card suggestions">
        <h2>
          <Users size={19} /> À découvrir
        </h2>
        {suggestions.map((person) => (
          <button
            className="member-row"
            key={person._id}
            onClick={() => openProfile(person._id)}
          >
            <Avatar user={person} />
            <span>{person.pseudo}</span>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {suggestions.length === 0 && (
          <p className="muted">Retrouvez vos contacts dans Explorer.</p>
        )}
        <a href="/trends" onClick={link("/trends")} className="rail-link">
          Toute la communauté
          <ChevronRight size={16} />
        </a>
      </section>
      <p className="rail-note">Bouger. Partager. Recommencer.</p>
    </aside>
  );
}
export function MobileNavigation({ path, link }: { path: string; link: Link }) {
  return (
    <nav className="mobile-nav" aria-label="Navigation mobile">
      {navigation
        .filter((n) => !["/likes"].includes(n[0]))
        .map(([url, label, Icon]) => (
          <a
            href={url}
            onClick={link(url)}
            key={url}
            className={path === url ? "active" : ""}
            aria-current={path === url ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{label === "Fil d’actualité" ? "Accueil" : label}</span>
          </a>
        ))}
    </nav>
  );
}
