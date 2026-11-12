import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiConfigured, config } from '../config';
import type { AccountManager } from '../accounts/accountManager';
import type { AgentService } from '../ai/agentService';
import { personaInputSchema, type PersonaStore } from '../ai/persona';
import type { SenderPool } from '../chat/senderPool';
import type { Engine } from '../scheduler/engine';
import { deleteScenario, listScenarios, saveScenario, scenarioSchema } from '../scheduler/scenario';
import type { WsHub } from './wsHub';

export interface Deps {
  accounts: AccountManager;
  personas: PersonaStore;
  agentService: AgentService;
  senderPool: SenderPool;
  engine: Engine;
  hub: WsHub;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { accounts, personas, agentService, senderPool, engine, hub } = deps;

  app.get('/ws', { websocket: true }, (socket) => {
    hub.add(socket);
    // Snapshot of current state for a freshly connected dashboard.
    socket.send(JSON.stringify({ type: 'scenario_status', ...engine.status }));
  });

  // ---- Accounts & OAuth ----

  app.get('/api/accounts', async () =>
    accounts.list().map((a) => ({ ...a, ...senderPool.status(a.userId) })),
  );

  app.get('/api/auth/start', async (_req, reply) => {
    reply.redirect(accounts.getAuthUrl());
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    if (query.error) {
      reply.type('text/html');
      return `<h2>Authorization failed</h2><p>${query.error_description ?? query.error}</p>`;
    }
    const account = await accounts.handleCallback(query.code ?? '');
    reply.type('text/html');
    return `<h2>Account added: ${account.userName}</h2><p>You can close this tab and return to the dashboard.</p>`;
  });

  app.delete('/api/accounts/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    senderPool.disconnect(userId);
    await accounts.remove(userId);
    return { ok: true };
  });

  app.post('/api/accounts/:userId/connect', async (req) => {
    const { userId } = req.params as { userId: string };
    if (!accounts.get(userId)) throw new Error(`Unknown account ${userId}`);
    await senderPool.connect(userId);
    return senderPool.status(userId);
  });

  app.post('/api/accounts/:userId/disconnect', async (req) => {
    const { userId } = req.params as { userId: string };
    senderPool.disconnect(userId);
    return senderPool.status(userId);
  });

  app.put('/api/accounts/:userId/persona', async (req) => {
    const { userId } = req.params as { userId: string };
    const { personaId } = z.object({ personaId: z.string().optional() }).parse(req.body);
    if (personaId && !personas.get(personaId)) throw new Error(`Unknown persona ${personaId}`);
    return accounts.assignPersona(userId, personaId);
  });

  // ---- Manual send ----

  app.post('/api/send', async (req) => {
    const { accountId, text } = z.object({ accountId: z.string(), text: z.string().min(1).max(450) }).parse(req.body);
    await senderPool.connect(accountId);
    senderPool.say(accountId, text);
    return { ok: true };
  });

  // ---- Personas ----

  app.get('/api/personas', async () => personas.list());

  app.post('/api/personas', async (req) => personas.create(personaInputSchema.parse(req.body)));

  app.put('/api/personas/:id', async (req) => {
    const { id } = req.params as { id: string };
    return personas.update(id, personaInputSchema.parse(req.body));
  });

  app.delete('/api/personas/:id', async (req) => {
    const { id } = req.params as { id: string };
    await personas.remove(id);
    return { ok: true };
  });

  app.post('/api/personas/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const persona = personas.get(id);
    if (!persona) throw new Error(`Unknown persona ${id}`);
    if (!agentService.enabled) {
      reply.code(503);
      return { error: 'Azure AI is not configured' };
    }
    const { streamContext } = z.object({ streamContext: z.string().default('') }).parse(req.body ?? {});
    const result = await agentService.preview(persona, personas, { streamContext, recentMessages: [] });
    if (!result) {
      reply.code(502);
      return { error: 'Generation failed — check server logs' };
    }
    return result;
  });

  // ---- Scenarios ----

  app.get('/api/scenarios', async () => listScenarios());

  app.put('/api/scenarios/:name', async (req) => {
    const scenario = scenarioSchema.parse(req.body);
    await saveScenario(scenario);
    return scenario;
  });

  app.delete('/api/scenarios/:name', async (req) => {
    const { name } = req.params as { name: string };
    await deleteScenario(name);
    return { ok: true };
  });

  app.post('/api/scenario/start', async (req, reply) => {
    if (engine.status.running) {
      reply.code(409);
      return { error: `Scenario "${engine.status.name}" is already running` };
    }
    const scenario = scenarioSchema.parse(req.body);
    await engine.start(scenario);
    return engine.status;
  });

  app.post('/api/scenario/stop', async () => {
    await engine.stop();
    return engine.status;
  });

  // ---- Status ----

  app.get('/api/status', async () => ({
    channel: config.TARGET_CHANNEL,
    aiConfigured,
    ...engine.status,
  }));

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : err.message;
    app.log.error(err);
    void reply.code(err.statusCode ?? 400).send({ error: message });
  });
}
