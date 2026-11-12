import { useState } from 'react';
import { api } from '../api';
import type { Account } from '../types';

interface Props {
  accounts: Account[];
  onError: (msg: string) => void;
}

const QUICK_EMOTES = ['Kappa', 'PogChamp', 'LUL', 'Kreygasm', 'BibleThump', 'HeyGuys', 'VoHiYo', 'NotLikeThis'];

export default function SendPanel({ accounts, onError }: Props) {
  const [accountId, setAccountId] = useState('');
  const [text, setText] = useState('');

  const selected = accountId || accounts[0]?.userId || '';

  const send = () => {
    if (!selected || !text.trim()) return;
    api.send(selected, text.trim())
      .then(() => setText(''))
      .catch((e: Error) => onError(e.message));
  };

  return (
    <section className="panel send-panel">
      <div className="send-row">
        <select value={selected} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.length === 0 && <option value="">no accounts</option>}
          {accounts.map((a) => (
            <option key={a.userId} value={a.userId}>{a.userName}</option>
          ))}
        </select>
        <input
          placeholder="Send a message as the selected account…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="primary" disabled={!selected || !text.trim()} onClick={send}>
          Send
        </button>
      </div>
      <div className="emote-row">
        {QUICK_EMOTES.map((emote) => (
          <button key={emote} className="emote-btn" onClick={() => setText((t) => (t ? `${t} ${emote}` : emote))}>
            {emote}
          </button>
        ))}
      </div>
    </section>
  );
}
