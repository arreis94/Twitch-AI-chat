import { ChatClient } from '@twurple/chat';
import { config } from '../config';

export interface EmoteSpan {
  id: string;
  code: string;
  start: number;
  end: number; // inclusive
}

export interface FeedMessage {
  id: string;
  channel: string;
  userId: string;
  userName: string;
  displayName: string;
  color?: string;
  text: string;
  isTestAccount: boolean;
  badges: Record<string, string>;
  emotes: EmoteSpan[];
  ts: number;
}

export interface ContextLine {
  user: string;
  text: string;
}

const RING_SIZE = 20;

/**
 * Single anonymous (read-only) connection to the target channel. Feeds the
 * dashboard live feed and keeps a ring buffer of recent messages as context
 * for the AI personas.
 */
export class ChannelListener {
  private client: ChatClient;
  private recent: ContextLine[] = [];
  private handlers: Array<(msg: FeedMessage) => void> = [];

  constructor(private isTestAccount: (userName: string) => boolean) {
    // No authProvider = anonymous justinfan connection.
    this.client = new ChatClient({ channels: [config.TARGET_CHANNEL] });

    this.client.onMessage((channel, user, text, msg) => {
      const emotes: EmoteSpan[] = [];
      for (const [emoteId, ranges] of msg.emoteOffsets) {
        for (const range of ranges) {
          const [start, end] = range.split('-').map(Number);
          emotes.push({ id: emoteId, code: text.slice(start, end + 1), start, end });
        }
      }
      emotes.sort((a, b) => a.start - b.start);

      const feedMsg: FeedMessage = {
        id: msg.id,
        channel,
        userId: msg.userInfo.userId,
        userName: user,
        displayName: msg.userInfo.displayName,
        color: msg.userInfo.color,
        text,
        isTestAccount: this.isTestAccount(user),
        badges: Object.fromEntries(msg.userInfo.badges),
        emotes,
        ts: Date.now(),
      };

      this.recent.push({ user: msg.userInfo.displayName, text });
      if (this.recent.length > RING_SIZE) this.recent.shift();

      for (const handler of this.handlers) handler(feedMsg);
    });
  }

  /** Subscribe to incoming channel messages (dashboard feed, engine reactions). */
  onMessage(handler: (msg: FeedMessage) => void): void {
    this.handlers.push(handler);
  }

  start(): void {
    this.client.connect();
  }

  /** Last N chat lines, oldest first — prompt context for persona agents. */
  getRecent(n = 10): ContextLine[] {
    return this.recent.slice(-n);
  }
}
