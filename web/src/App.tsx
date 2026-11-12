import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useWebSocket } from './useWebSocket';
import type { Account, AppStatus, FeedMessage, Persona, ServerEvent } from './types';
import AccountsPanel from './components/AccountsPanel';
import PersonaPanel from './components/PersonaPanel';
import SendPanel from './components/SendPanel';
import ScenarioPanel from './components/ScenarioPanel';
import ChatFeed from './components/ChatFeed';

const FEED_LIMIT = 300;

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const refreshAccounts = useCallback(() => {
    api.accounts().then(setAccounts).catch(console.error);
  }, []);
  const refreshPersonas = useCallback(() => {
    api.personas().then(setPersonas).catch(console.error);
  }, []);
  const refreshStatus = useCallback(() => {
    api.status().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    refreshAccounts();
    refreshPersonas();
    refreshStatus();
  }, [refreshAccounts, refreshPersonas, refreshStatus]);

  const pushError = useCallback((message: string) => {
    setErrors((prev) => [...prev.slice(-4), message]);
    window.setTimeout(() => setErrors((prev) => prev.slice(1)), 8000);
  }, []);

  useWebSocket(
    useCallback(
      (ev: ServerEvent) => {
        switch (ev.type) {
          case 'chat':
            setFeed((prev) => [...prev.slice(-FEED_LIMIT + 1), ev.msg]);
            break;
          case 'account_status':
            setAccounts((prev) =>
              prev.map((a) =>
                a.userId === ev.userId ? { ...a, connected: ev.connected, queueDepth: ev.queueDepth } : a,
              ),
            );
            break;
          case 'scenario_status':
            setStatus((prev) => (prev ? { ...prev, ...ev } : prev));
            break;
          case 'error':
            pushError(ev.message);
            break;
          case 'generation':
            // surfaced implicitly when the message echoes back through chat
            break;
        }
      },
      [pushError],
    ),
  );

  return (
    <div className="app">
      <header>
        <h1>Twitch Chat Simulator</h1>
        <div className="header-status">
          {status && (
            <>
              <span className="chip">#{status.channel}</span>
              <span className={`chip ${status.aiConfigured ? 'ok' : 'warn'}`}>
                AI {status.aiConfigured ? 'ready' : 'not configured'}
              </span>
              {status.running && (
                <span className="chip running">
                  ▶ {status.name} ({status.mode}) — {status.sentCount} sent
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {errors.length > 0 && (
        <div className="errors">
          {errors.map((e, i) => (
            <div key={i} className="error-toast">{e}</div>
          ))}
        </div>
      )}

      <main>
        <div className="left">
          <AccountsPanel
            accounts={accounts}
            personas={personas}
            onChanged={refreshAccounts}
            onError={pushError}
          />
          <PersonaPanel
            personas={personas}
            aiConfigured={status?.aiConfigured ?? false}
            onChanged={refreshPersonas}
            onError={pushError}
          />
          <ScenarioPanel
            accounts={accounts}
            personas={personas}
            status={status}
            onError={pushError}
          />
        </div>
        <div className="right">
          <ChatFeed feed={feed} />
          <SendPanel accounts={accounts} onError={pushError} />
        </div>
      </main>
    </div>
  );
}
