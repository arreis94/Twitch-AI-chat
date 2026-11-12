import crypto from 'node:crypto';
import { AgentsClient, isOutputOfType, type MessageTextContent } from '@azure/ai-agents';
import { DefaultAzureCredential } from '@azure/identity';
import { aiConfigured, config } from '../config';
import type { ContextLine } from '../chat/listener';
import type { Persona, PersonaStore } from './persona';
import { sanitizeChatMessage } from './sanitize';

export interface AgentSession {
  personaId: string;
  agentId: string;
  threadId: string;
}

export interface GenerationContext {
  streamContext: string;
  recentMessages: ContextLine[];
  /** Twitch usernames of the other simulated chatters currently present. */
  otherChatters?: string[];
  /** Set when this generation is a reply to a specific message. */
  replyTo?: { user: string; text: string };
}

export interface GenerationResult {
  text: string;
  latencyMs: number;
}

function buildInstructions(persona: Persona): string {
  return [
    `You are roleplaying a Twitch chat viewer named "${persona.name}" in a live stream chat.`,
    `Personality: ${persona.personality}`,
    persona.interests.length ? `Topics you care about: ${persona.interests.join(', ')}.` : '',
    persona.favoriteEmotes.length
      ? `Twitch emotes you like to use (write them as plain words, exactly as given): ${persona.favoriteEmotes.join(', ')}.`
      : '',
    `You write in ${persona.language}.`,
    persona.verbosity === 'short'
      ? 'Keep messages very short — a few words to one sentence, like real Twitch chat.'
      : 'Keep messages short — one to two casual sentences.',
    'RULES: Reply with exactly ONE chat message. No quotation marks around it, no role prefix, no newlines, no hashtags, no explanations.',
    'You can react to what other chatters say and occasionally tag someone with @TheirName — but do NOT tag someone in every message.',
    'If you have already gone back and forth with the same person a couple of times, let the conversation die naturally instead of replying again.',
    'Do not repeat yourself or paraphrase your own recent messages.',
    'Do not mention being an AI. Stay in character.',
    'Stay within Twitch community guidelines: no harassment, hate, slurs, sexual content, or spam directed at other users.',
  ]
    .filter(Boolean)
    .join('\n');
}

export class AgentService {
  private client: AgentsClient | null = null;

  get enabled(): boolean {
    return aiConfigured;
  }

  private getClient(): AgentsClient {
    if (!aiConfigured) {
      throw new Error('Azure AI is not configured — set AZURE_AI_PROJECT_ENDPOINT and AZURE_AI_MODEL_DEPLOYMENT in .env');
    }
    this.client ??= new AgentsClient(config.AZURE_AI_PROJECT_ENDPOINT!, new DefaultAzureCredential());
    return this.client;
  }

  /** Create (or reuse) the Azure agent backing a persona; cache its id in the persona file. */
  async ensureAgent(persona: Persona, store: PersonaStore): Promise<string> {
    const client = this.getClient();
    const instructions = buildInstructions(persona);
    const hash = crypto
      .createHash('sha256')
      .update(`${config.AZURE_AI_MODEL_DEPLOYMENT}\n${instructions}`)
      .digest('hex');

    if (persona.azureAgentId && persona.instructionsHash === hash) {
      return persona.azureAgentId;
    }

    // Definition changed (or first use): drop the stale agent, create a fresh one.
    if (persona.azureAgentId) {
      try {
        await client.deleteAgent(persona.azureAgentId);
      } catch {
        // stale/already deleted — ignore
      }
    }
    const agent = await client.createAgent(config.AZURE_AI_MODEL_DEPLOYMENT!, {
      name: `twitch-sim-${persona.name}`,
      instructions,
    });
    persona.azureAgentId = agent.id;
    persona.instructionsHash = hash;
    await store.save(persona);
    return agent.id;
  }

  /** One thread per account per scenario run — keeps the persona's own short-term memory. */
  async startSession(persona: Persona, store: PersonaStore): Promise<AgentSession> {
    const agentId = await this.ensureAgent(persona, store);
    const thread = await this.getClient().threads.create();
    return { personaId: persona.id, agentId, threadId: thread.id };
  }

  async endSession(session: AgentSession): Promise<void> {
    try {
      await this.getClient().threads.delete(session.threadId);
    } catch {
      // best effort cleanup
    }
  }

  async generate(session: AgentSession, context: GenerationContext): Promise<GenerationResult | null> {
    const client = this.getClient();
    const start = Date.now();

    const chatLog = context.recentMessages.length
      ? context.recentMessages.map((m) => `${m.user}: ${m.text}`).join('\n')
      : '(chat is quiet right now)';
    const prompt = [
      context.streamContext ? `Stream context: ${context.streamContext}` : '',
      context.otherChatters?.length
        ? `Other chatters present (you may tag them with @name): ${context.otherChatters.join(', ')}`
        : '',
      `Recent chat:\n${chatLog}`,
      context.replyTo
        ? `${context.replyTo.user} just wrote: "${context.replyTo.text}" — write a short reply to them (you may tag them as @${context.replyTo.user}, or let the exchange end if there is nothing left to say).`
        : 'Write your next chat message now.',
    ]
      .filter(Boolean)
      .join('\n\n');

    await client.messages.create(session.threadId, 'user', prompt);
    const run = await client.runs.createAndPoll(session.threadId, session.agentId, {
      pollingOptions: { intervalInMs: 500 },
    });
    if (run.status !== 'completed') {
      console.error(`agent run ended with status ${run.status}`, run.lastError ?? '');
      return null;
    }

    const messages = client.messages.list(session.threadId, { order: 'desc', limit: 5 });
    for await (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      const textContent = msg.content.find((c) => isOutputOfType<MessageTextContent>(c, 'text'));
      if (textContent && 'text' in textContent) {
        const text = sanitizeChatMessage((textContent as MessageTextContent).text.value);
        if (!text) return null;
        return { text, latencyMs: Date.now() - start };
      }
    }
    return null;
  }

  /** One-off generation to test a persona from the dashboard without sending to Twitch. */
  async preview(persona: Persona, store: PersonaStore, context: GenerationContext): Promise<GenerationResult | null> {
    const session = await this.startSession(persona, store);
    try {
      return await this.generate(session, context);
    } finally {
      await this.endSession(session);
    }
  }
}
