import { api } from '../api';
import type { Account, Persona } from '../types';

interface Props {
  accounts: Account[];
  personas: Persona[];
  onChanged: () => void;
  onError: (msg: string) => void;
}

export default function AccountsPanel({ accounts, personas, onChanged, onError }: Props) {
  const run = (fn: () => Promise<unknown>) => {
    fn().then(onChanged).catch((e: Error) => onError(e.message));
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Test accounts</h2>
        <button onClick={() => window.open('/api/auth/start', '_blank')}>+ Add account</button>
      </div>
      <p className="hint">
        Log into the <em>test account</em> in an incognito window before clicking Add, then refresh.
      </p>
      {accounts.length === 0 && <p className="empty">No accounts yet.</p>}
      <ul className="account-list">
        {accounts.map((a) => (
          <li key={a.userId}>
            <span className={`dot ${a.connected ? 'on' : 'off'}`} title={a.connected ? 'connected' : 'disconnected'} />
            <span className="account-name">{a.userName}</span>
            {a.queueDepth > 0 && <span className="queue">queue: {a.queueDepth}</span>}
            <select
              value={a.personaId ?? ''}
              onChange={(e) => run(() => api.assignPersona(a.userId, e.target.value || undefined))}
              title="Persona"
            >
              <option value="">— no persona —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {a.connected ? (
              <button onClick={() => run(() => api.disconnectAccount(a.userId))}>Disconnect</button>
            ) : (
              <button onClick={() => run(() => api.connectAccount(a.userId))}>Connect</button>
            )}
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Remove ${a.userName} and its stored token?`)) run(() => api.removeAccount(a.userId));
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button className="link" onClick={onChanged}>↻ Refresh</button>
    </section>
  );
}
