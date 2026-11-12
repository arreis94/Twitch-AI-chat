/**
 * Per-account send throttle: FIFO queue drained by a sliding-window limiter.
 * 18 messages per 30s keeps a safety margin under Twitch's 20/30s for
 * non-mod/VIP accounts, independent of Twurple's internal limiter.
 */
export class Throttle {
  private queue: string[] = [];
  private sentAt: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private send: (text: string) => Promise<void>,
    private onDepthChange: (depth: number) => void,
    private limit = 18,
    private windowMs = 30_000,
  ) {}

  get depth(): number {
    return this.queue.length;
  }

  enqueue(text: string): void {
    if (this.stopped) return;
    this.queue.push(text);
    this.onDepthChange(this.queue.length);
    this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private drain(): void {
    if (this.stopped || this.timer) return;
    const now = Date.now();
    this.sentAt = this.sentAt.filter((t) => now - t < this.windowMs);

    if (this.queue.length === 0) return;

    if (this.sentAt.length < this.limit) {
      const text = this.queue.shift()!;
      this.sentAt.push(now);
      this.onDepthChange(this.queue.length);
      void this.send(text).catch((err) => console.error('send failed:', err));
      // Yield before next drain so sends are not bursted back-to-back.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, 150);
    } else {
      const waitUntil = this.sentAt[0] + this.windowMs - now + 50;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitUntil);
    }
  }
}
