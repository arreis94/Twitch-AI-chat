import { ChatClient } from '@twurple/chat';
import { config } from '../config';
import { createAuthProviderForUser } from '../accounts/authProvider';
import { Throttle } from './throttle';

export interface SenderStatus {
  userId: string;
  connected: boolean;
  queueDepth: number;
}

interface Sender {
  client: ChatClient;
  throttle: Throttle;
  connected: boolean;
}

export class SenderPool {
  private senders = new Map<string, Sender>();

  constructor(
    private onStatus: (status: SenderStatus) => void,
    private onError: (message: string) => void,
    private nameOf: (userId: string) => string,
  ) {}

  status(userId: string): SenderStatus {
    const s = this.senders.get(userId);
    return { userId, connected: s?.connected ?? false, queueDepth: s?.throttle.depth ?? 0 };
  }

  isConnected(userId: string): boolean {
    return this.senders.get(userId)?.connected ?? false;
  }

  async connect(userId: string): Promise<void> {
    if (this.senders.has(userId)) return;

    const authProvider = await createAuthProviderForUser(userId);
    const client = new ChatClient({
      authProvider,
      channels: [config.TARGET_CHANNEL],
    });

    const name = this.nameOf(userId);
    const sender: Sender = {
      client,
      connected: false,
      throttle: new Throttle(
        async (text) =>
          client.say(config.TARGET_CHANNEL, text).catch((err) => {
            this.onError(`[${name}] send failed: ${err instanceof Error ? err.message : err}`);
          }),
        () => this.emit(userId),
      ),
    };
    this.senders.set(userId, sender);

    // "Connected" means Twitch accepted the login — a socket can be open while
    // auth failed, in which case every send is silently useless.
    client.onAuthenticationSuccess(() => {
      sender.connected = true;
      this.emit(userId);
    });
    client.onAuthenticationFailure((text) => {
      sender.connected = false;
      this.emit(userId);
      this.onError(`[${name}] Twitch authentication failed: ${text}`);
    });
    client.onDisconnect(() => {
      sender.connected = false;
      this.emit(userId);
    });
    client.onJoinFailure((channel, reason) => {
      this.onError(`[${name}] could not join ${channel}: ${reason}`);
    });
    client.onMessageFailed((channel, reason) => {
      this.onError(`[${name}] message rejected in ${channel}: ${reason}`);
    });
    client.onMessageRatelimit((channel) => {
      this.onError(`[${name}] message dropped by rate limit in ${channel}`);
    });
    // Twitch explains silent drops via notices (verified email/phone required,
    // followers-only, duplicate message, banned, ...). Surface them all.
    client.onNoPermission((channel, text) => {
      this.onError(`[${name}] no permission in ${channel}: ${text}`);
    });
    client.onTokenFetchFailure((err) => {
      this.onError(`[${name}] token refresh failed: ${err.message}`);
    });

    client.connect();
  }

  disconnect(userId: string): void {
    const sender = this.senders.get(userId);
    if (!sender) return;
    sender.throttle.stop();
    sender.client.quit();
    this.senders.delete(userId);
    this.onStatus({ userId, connected: false, queueDepth: 0 });
  }

  disconnectAll(): void {
    for (const userId of [...this.senders.keys()]) this.disconnect(userId);
  }

  /** Enqueue a message; the throttle enforces Twitch rate limits. */
  say(userId: string, text: string): void {
    const sender = this.senders.get(userId);
    if (!sender) throw new Error(`Account ${userId} is not connected`);
    sender.throttle.enqueue(text);
  }

  private emit(userId: string): void {
    this.onStatus(this.status(userId));
  }
}
