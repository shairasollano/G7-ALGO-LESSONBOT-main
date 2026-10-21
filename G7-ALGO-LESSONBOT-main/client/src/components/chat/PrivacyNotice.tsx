interface PrivacyNoticeProps {
  onClose: () => void;
}

export function PrivacyNotice({ onClose }: PrivacyNoticeProps) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="privacy-title" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 id="privacy-title">Privacy &amp; data</h2>
        <div className="modal-body">
          <ul>
            <li>
              <strong>No accounts, no database.</strong> This MVP stores nothing on a server-side
              database. Your conversation exists only in this browser tab and is lost on refresh.
            </li>
            <li>
              <strong>Local reset.</strong> Use <em>New chat</em> above to clear the current
              conversation at any time.
            </li>
            <li>
              <strong>AI provider.</strong> The curated tutor works fully offline. If an AI provider
              is enabled by the project owner, messages you send are transmitted to that provider's
              API and may be used under that provider's terms (including for service improvement on
              free tiers). Do not submit sensitive, confidential, or personal information.
            </li>
            <li>
              <strong>Computed results.</strong> All algorithm traces, graph data, and quiz answer
              keys are computed by the app's own deterministic code on the backend — not generated
              by the AI.
            </li>
          </ul>
        </div>
        <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
