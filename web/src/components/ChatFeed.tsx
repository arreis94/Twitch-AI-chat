import { useEffect, useRef } from 'react';
import type { FeedMessage } from '../types';

interface Props {
  feed: FeedMessage[];
}

function renderWithEmotes(msg: FeedMessage) {
  if (msg.emotes.length === 0) return msg.text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const emote of msg.emotes) {
    if (emote.start > cursor) parts.push(msg.text.slice(cursor, emote.start));
    parts.push(
      <img
        key={`${emote.id}-${emote.start}`}
        className="emote"
        alt={emote.code}
        title={emote.code}
        src={`https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`}
      />,
    );
    cursor = emote.end + 1;
  }
  if (cursor < msg.text.length) parts.push(msg.text.slice(cursor));
  return parts;
}

export default function ChatFeed({ feed }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [feed]);

  return (
    <section className="panel chat-feed">
      <h2>Live chat</h2>
      <div className="feed-scroll">
        {feed.length === 0 && <p className="empty">Waiting for chat messages…</p>}
        {feed.map((msg) => (
          <div key={msg.id} className={`chat-line ${msg.isTestAccount ? 'test-account' : ''}`}>
            <span className="chat-time">
              {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            {Object.keys(msg.badges).length > 0 && (
              <span className="chat-badges" title={Object.keys(msg.badges).join(', ')}>
                {Object.keys(msg.badges).includes('broadcaster') ? '📺' : ''}
                {Object.keys(msg.badges).includes('moderator') ? '🗡' : ''}
              </span>
            )}
            <span className="chat-user" style={{ color: msg.color || '#9aa0ff' }}>
              {msg.displayName}
              {msg.isTestAccount && <span className="sim-tag">sim</span>}
            </span>
            <span className="chat-text">{renderWithEmotes(msg)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
