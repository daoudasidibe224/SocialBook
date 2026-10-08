import type { usePersistentDraft } from "../usePersistentDraft";
export default function DraftNotice({
  draft,
  busy,
}: {
  draft: ReturnType<typeof usePersistentDraft>;
  busy: boolean;
}) {
  if (!draft.notice && !draft.text && !draft.photo) return null;
  return (
    <div className="draft-notice">
      {draft.notice && (
        <p className={draft.conflict ? "form-error" : "muted"} role="status">
          {draft.notice}
        </p>
      )}
      {draft.conflict ? (
        <div className="composer-footer">
          <button
            type="button"
            className="photo-button"
            disabled={busy}
            onClick={() => void draft.keepCurrent()}
          >
            Garder ma saisie
          </button>
          <button
            type="button"
            className="photo-button"
            disabled={busy}
            onClick={draft.reload}
          >
            Charger l’autre version
          </button>
        </div>
      ) : draft.text || draft.photo ? (
        <button
          type="button"
          className="photo-button"
          disabled={busy}
          onClick={() => void draft.discard()}
        >
          Effacer le brouillon
        </button>
      ) : null}
    </div>
  );
}
