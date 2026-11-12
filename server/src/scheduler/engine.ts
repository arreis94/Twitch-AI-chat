import type { AccountManager } from '../accounts/accountManager';
import type { AgentService, AgentSession } from '../ai/agentService';
import type { PersonaStore } from '../ai/persona';
import type { ChannelListener, FeedMessage } from '../chat/listener';
import type { SenderPool } from '../chat/senderPool';
import type { Scenario } from './scenario';

export interface EngineEvents {
  onScenarioStatus: (status: ScenarioStatus) => void;
  onGeneration: (ev: { accountId: string; personaName: string; text: string; latencyMs: number }) => void;
  onError: (message: string) => void;
}

export interface ScenarioStatus {
  running: boolean;
  name?: string;
  mode?: 'ai' | 'pool';
  sentCount: number;
}

const MAX_INFLIGHT_GENERATIONS = 3;

// Anti-loop guards for reactive replies (mentions / spontaneous reactions).
// These are hard caps — persona instructions also discourage endless
// back-and-forth, but prompts alone cannot be trusted to terminate loops.
const REPLY_DELAY_MIN_MS = 2_000; // human-like reading/typing delay
const REPLY_DELAY_MAX_MS = 8_000;
const REACTIVE_COOLDOWN_MS = 15_000; // min gap between reactive replies per account
const PAIR_WINDOW_MS = 120_000; // A may reply reactively to B at most...
const PAIR_MAX_REPLIES = 2; // ...this many times per window (kills A<->B ping-pong)
const GLOBAL_REACTIVE_WINDOW_MS = 60_000;
const GLOBAL_REACTIVE_MAX = 8; // total reactive replies per minute, all accounts

interface Participant {
  accountId: string;
  userName: string;
  session?: AgentSession;
  personaName?: string;
  timer?: NodeJS.Timeout;
  replyTimer?: NodeJS.Timeout;
  periodMs: number;
  lastReactiveAt: number;
}

/** Runs at most one scenario at a time. */
export class Engine {
  private scenario: Scenario | null = null;
  private participants: Participant[] = [];
  private poolTimer: NodeJS.Timeout | null = null;
  private durationTimer: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;
  private sentCount = 0;
  private inFlight = 0;
  private generation = 0; // guards stray timers from a stopped run
  private pairHistory = new Map<string, number[]>(); // "replier|author" -> reply timestamps
  private reactiveTimes: number[] = [];

  constructor(
    private accounts: AccountManager,
    private personas: PersonaStore,
    private agentService: AgentService,
    private senderPool: SenderPool,
    private listener: ChannelListener,
    private events: EngineEvents,
  ) {}

  get status(): ScenarioStatus {
    return {
      running: this.scenario !== null,
      name: this.scenario?.name,
      mode: this.scenario?.mode,
      sentCount: this.sentCount,
    };
  }

  async start(scenario: Scenario): Promise<void> {
    if (this.scenario) throw new Error(`Scenario "${this.scenario.name}" is already running`);
    if (scenario.mode === 'ai' && !this.agentService.enabled) {
      throw new Error('AI mode requires Azure AI configuration (AZURE_AI_PROJECT_ENDPOINT / AZURE_AI_MODEL_DEPLOYMENT)');
    }

    // Connect all participating accounts first.
    for (const accountId of scenario.accountIds) {
      if (!this.accounts.get(accountId)) throw new Error(`Unknown account ${accountId}`);
      await this.senderPool.connect(accountId);
    }

    this.scenario = scenario;
    this.sentCount = 0;
    this.pairHistory.clear();
    this.reactiveTimes = [];
    const gen = ++this.generation;

    if (scenario.mode === 'ai') {
      for (const accountId of scenario.accountIds) {
        const account = this.accounts.get(accountId)!;
        const persona = account.personaId ? this.personas.get(account.personaId) : undefined;
        if (!persona) {
          await this.rollback();
          throw new Error(`Account ${account.userName} has no persona assigned`);
        }
        const session = await this.agentService.startSession(persona, this.personas);
        const periodMs = 60_000 / (persona.chattiness * scenario.rateMultiplier);
        this.participants.push({
          accountId,
          userName: account.userName,
          session,
          personaName: persona.name,
          periodMs,
          lastReactiveAt: 0,
        });
      }
      for (const p of this.participants) this.scheduleAiTick(p, gen, true);
    } else {
      this.participants = scenario.accountIds.map((accountId) => ({
        accountId,
        userName: this.accounts.get(accountId)!.userName,
        periodMs: 0,
        lastReactiveAt: 0,
      }));
      this.schedulePoolTick(gen, true);
    }

    if (scenario.durationSec) {
      this.durationTimer = setTimeout(() => void this.stop(), scenario.durationSec * 1000);
    }
    this.emitStatus();
  }

  async stop(): Promise<void> {
    if (!this.scenario) return;
    this.generation++;
    if (this.poolTimer) clearTimeout(this.poolTimer);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    this.poolTimer = null;
    this.durationTimer = null;

    const sessions = this.participants.filter((p) => p.session).map((p) => p.session!);
    for (const p of this.participants) {
      if (p.timer) clearTimeout(p.timer);
      if (p.replyTimer) clearTimeout(p.replyTimer);
    }
    this.participants = [];
    this.scenario = null;
    this.pairHistory.clear();
    this.reactiveTimes = [];
    this.emitStatus();

    // Thread cleanup after the run is already stopped (best effort).
    await Promise.allSettled(sessions.map((s) => this.agentService.endSession(s)));
  }

  /**
   * Called for every message seen in the channel (including echoes of our own
   * sends). Mentioned participants schedule a reply; otherwise one random
   * participant may react with probability `scenario.reactivity`.
   */
  handleChatMessage(msg: FeedMessage): void {
    const scenario = this.scenario;
    if (!scenario || scenario.mode !== 'ai') return;

    const others = this.participants.filter((p) => p.accountId !== msg.userId);
    if (others.length === 0) return;

    const mentioned = others.filter((p) => this.mentions(msg.text, p.userName));
    let reactors: Participant[];
    if (mentioned.length > 0) {
      reactors = mentioned;
    } else if (Math.random() < scenario.reactivity) {
      reactors = [others[Math.floor(Math.random() * others.length)]];
    } else {
      return;
    }

    for (const p of reactors) this.scheduleReply(p, msg, this.generation);
  }

  private mentions(text: string, userName: string): boolean {
    const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w])@?${escaped}([^\\w]|$)`, 'i').test(text);
  }

  private scheduleReply(p: Participant, msg: FeedMessage, gen: number): void {
    const now = Date.now();

    // --- Anti-loop guards (checked at schedule time so bursts can't race past them) ---
    if (p.replyTimer) return; // a reply is already pending for this account
    if (now - p.lastReactiveAt < REACTIVE_COOLDOWN_MS) return;

    this.reactiveTimes = this.reactiveTimes.filter((t) => now - t < GLOBAL_REACTIVE_WINDOW_MS);
    if (this.reactiveTimes.length >= GLOBAL_REACTIVE_MAX) return;

    const pairKey = `${p.accountId}|${msg.userId}`;
    const pair = (this.pairHistory.get(pairKey) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
    if (pair.length >= PAIR_MAX_REPLIES) return;

    pair.push(now);
    this.pairHistory.set(pairKey, pair);
    this.reactiveTimes.push(now);

    const delay = REPLY_DELAY_MIN_MS + Math.random() * (REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS);
    p.replyTimer = setTimeout(() => {
      p.replyTimer = undefined;
      p.lastReactiveAt = Date.now();
      void this.generateAndSend(p, gen, { user: msg.displayName, text: msg.text });
    }, delay);
  }

  private async generateAndSend(
    p: Participant,
    gen: number,
    replyTo?: { user: string; text: string },
  ): Promise<void> {
    if (gen !== this.generation || !this.scenario || !p.session) return;
    // Reactive replies are opportunistic: drop them when the budget is full
    // instead of queueing (scheduled ticks reschedule in aiTick instead).
    if (replyTo && this.inFlight >= MAX_INFLIGHT_GENERATIONS) return;

    this.inFlight++;
    try {
      const result = await this.agentService.generate(p.session, {
        streamContext: this.scenario.streamContext,
        recentMessages: this.listener.getRecent(10),
        otherChatters: this.participants.filter((x) => x.accountId !== p.accountId).map((x) => x.userName),
        replyTo,
      });
      if (gen !== this.generation) return; // stopped while generating
      if (result) {
        this.senderPool.say(p.accountId, result.text);
        this.sentCount++;
        this.events.onGeneration({
          accountId: p.accountId,
          personaName: p.personaName ?? '',
          text: result.text,
          latencyMs: result.latencyMs,
        });
        this.emitStatus();
      }
    } catch (err) {
      this.events.onError(`Generation failed for ${p.personaName}: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.inFlight--;
    }
  }

  private async rollback(): Promise<void> {
    const sessions = this.participants.filter((p) => p.session).map((p) => p.session!);
    this.participants = [];
    this.scenario = null;
    await Promise.allSettled(sessions.map((s) => this.agentService.endSession(s)));
  }

  private jittered(periodMs: number, jitter: number): number {
    const factor = 1 + (Math.random() * 2 - 1) * jitter;
    return Math.max(500, periodMs * factor);
  }

  private scheduleAiTick(p: Participant, gen: number, first: boolean): void {
    // First tick is staggered randomly within one period so accounts don't fire together.
    const delay = first ? Math.random() * p.periodMs : this.jittered(p.periodMs, 0.3);
    p.timer = setTimeout(() => void this.aiTick(p, gen), delay);
  }

  private async aiTick(p: Participant, gen: number): Promise<void> {
    if (gen !== this.generation || !this.scenario || !p.session) return;

    if (this.inFlight >= MAX_INFLIGHT_GENERATIONS) {
      // Generation budget exhausted — retry shortly instead of piling up runs.
      p.timer = setTimeout(() => void this.aiTick(p, gen), 2000);
      return;
    }

    await this.generateAndSend(p, gen);
    if (gen === this.generation) this.scheduleAiTick(p, gen, false);
  }

  private schedulePoolTick(gen: number, first: boolean): void {
    const scenario = this.scenario!;
    const periodMs = 60_000 / scenario.messagesPerMinute;
    const delay = first ? Math.random() * periodMs : this.jittered(periodMs, scenario.jitter);
    this.poolTimer = setTimeout(() => this.poolTick(gen), delay);
  }

  private poolTick(gen: number): void {
    if (gen !== this.generation || !this.scenario) return;
    const scenario = this.scenario;

    const text = scenario.messagePool[Math.floor(Math.random() * scenario.messagePool.length)];
    const accountId =
      scenario.accountSelection === 'random'
        ? scenario.accountIds[Math.floor(Math.random() * scenario.accountIds.length)]
        : scenario.accountIds[this.roundRobinIndex++ % scenario.accountIds.length];

    try {
      this.senderPool.say(accountId, text);
      this.sentCount++;
      this.emitStatus();
    } catch (err) {
      this.events.onError(`Send failed: ${err instanceof Error ? err.message : err}`);
    }
    this.schedulePoolTick(gen, false);
  }

  private emitStatus(): void {
    this.events.onScenarioStatus(this.status);
  }
}
