import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Account, AppStatus, Persona, Scenario } from '../types';

interface Props {
  accounts: Account[];
  personas: Persona[];
  status: AppStatus | null;
  onError: (msg: string) => void;
}

const defaultScenario: Scenario = {
  name: 'my-scenario',
  mode: 'ai',
  accountIds: [],
  streamContext: '',
  rateMultiplier: 1,
  reactivity: 0.3,
  messagesPerMinute: 10,
  jitter: 0.3,
  accountSelection: 'roundRobin',
  messagePool: [],
};

export default function ScenarioPanel({ accounts, personas, status, onError }: Props) {
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);
  const [saved, setSaved] = useState<Scenario[]>([]);

  const refreshSaved = () => api.scenarios().then(setSaved).catch(console.error);
  useEffect(() => {
    refreshSaved();
  }, []);

  const toggleAccount = (userId: string) => {
    setScenario((s) => ({
      ...s,
      accountIds: s.accountIds.includes(userId)
        ? s.accountIds.filter((id) => id !== userId)
        : [...s.accountIds, userId],
    }));
  };

  const personaFor = (a: Account): Persona | undefined => personas.find((p) => p.id === a.personaId);

  const start = () => {
    api.startScenario(scenario).catch((e: Error) => onError(e.message));
  };
  const stop = () => {
    api.stopScenario().catch((e: Error) => onError(e.message));
  };
  const save = () => {
    api.saveScenario(scenario).then(refreshSaved).catch((e: Error) => onError(e.message));
  };

  const running = status?.running ?? false;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Scenario</h2>
        {running ? (
          <button className="danger" onClick={stop}>■ Stop</button>
        ) : (
          <button className="primary" disabled={scenario.accountIds.length === 0} onClick={start}>
            ▶ Start
          </button>
        )}
      </div>

      <div className="field-row">
        <label className="field">
          Name
          <input value={scenario.name} onChange={(e) => setScenario({ ...scenario, name: e.target.value })} />
        </label>
        <label className="field">
          Mode
          <select
            value={scenario.mode}
            onChange={(e) => setScenario({ ...scenario, mode: e.target.value as Scenario['mode'] })}
          >
            <option value="ai">AI personas</option>
            <option value="pool">Static pool</option>
          </select>
        </label>
        <label className="field">
          Duration (sec, empty = until stopped)
          <input
            type="number"
            min={0}
            value={scenario.durationSec ?? ''}
            onChange={(e) =>
              setScenario({ ...scenario, durationSec: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </label>
      </div>

      <fieldset className="field">
        <legend>Participants</legend>
        {accounts.length === 0 && <p className="empty">Add accounts first.</p>}
        {accounts.map((a) => {
          const persona = personaFor(a);
          return (
            <label key={a.userId} className="check-row">
              <input
                type="checkbox"
                checked={scenario.accountIds.includes(a.userId)}
                onChange={() => toggleAccount(a.userId)}
              />
              {a.userName}
              <span className="muted">
                {scenario.mode === 'ai' ? (persona ? ` as ${persona.name}` : ' — no persona!') : ''}
              </span>
            </label>
          );
        })}
      </fieldset>

      {scenario.mode === 'ai' ? (
        <>
          <label className="field">
            Stream context (what agents react to)
            <textarea
              rows={2}
              placeholder="Streamer is playing Elden Ring, just died to Malenia for the 10th time"
              value={scenario.streamContext}
              onChange={(e) => setScenario({ ...scenario, streamContext: e.target.value })}
            />
          </label>
          <label className="field">
            Rate multiplier ×{scenario.rateMultiplier.toFixed(1)} (scales persona chattiness)
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={scenario.rateMultiplier}
              onChange={(e) => setScenario({ ...scenario, rateMultiplier: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Reactivity {Math.round(scenario.reactivity * 100)}% (chance to react to a message; mentions always trigger a reply)
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={scenario.reactivity}
              onChange={(e) => setScenario({ ...scenario, reactivity: Number(e.target.value) })}
            />
          </label>
        </>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              Messages/min: {scenario.messagesPerMinute}
              <input
                type="range"
                min={1}
                max={120}
                value={scenario.messagesPerMinute}
                onChange={(e) => setScenario({ ...scenario, messagesPerMinute: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Account selection
              <select
                value={scenario.accountSelection}
                onChange={(e) =>
                  setScenario({ ...scenario, accountSelection: e.target.value as Scenario['accountSelection'] })
                }
              >
                <option value="roundRobin">round robin</option>
                <option value="random">random</option>
              </select>
            </label>
          </div>
          <label className="field">
            Message pool (one per line, emote codes allowed)
            <textarea
              rows={5}
              placeholder={'that was insane PogChamp\nLUL\nhi chat HeyGuys'}
              value={scenario.messagePool.join('\n')}
              onChange={(e) =>
                setScenario({ ...scenario, messagePool: e.target.value.split('\n').filter((l) => l.trim()) })
              }
            />
          </label>
        </>
      )}

      <div className="editor-actions">
        <button onClick={save}>Save scenario</button>
        {saved.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const found = saved.find((s) => s.name === e.target.value);
              if (found) setScenario(found);
            }}
          >
            <option value="">Load saved…</option>
            {saved.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        )}
      </div>
    </section>
  );
}
