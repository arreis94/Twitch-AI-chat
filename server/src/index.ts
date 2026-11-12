import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config';
import { AccountManager } from './accounts/accountManager';
import { AgentService } from './ai/agentService';
import { PersonaStore } from './ai/persona';
import { ChannelListener } from './chat/listener';
import { SenderPool } from './chat/senderPool';
import { Engine } from './scheduler/engine';
import { registerRoutes } from './api/routes';
import { WsHub } from './api/wsHub';

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(websocket);

  const hub = new WsHub();

  const accounts = new AccountManager(`http://localhost:${config.PORT}/api/auth/callback`);
  await accounts.load();

  const personas = new PersonaStore();
  await personas.load();

  const agentService = new AgentService();

  const senderPool = new SenderPool(
    (status) => hub.broadcast({ type: 'account_status', ...status }),
    (message) => {
      app.log.error(message);
      hub.broadcast({ type: 'error', message });
    },
    (userId) => accounts.get(userId)?.userName ?? userId,
  );

  const listener = new ChannelListener((userName) => accounts.isTestAccount(userName));
  listener.onMessage((msg) => hub.broadcast({ type: 'chat', msg }));

  const engine = new Engine(accounts, personas, agentService, senderPool, listener, {
    onScenarioStatus: (status) => hub.broadcast({ type: 'scenario_status', ...status }),
    onGeneration: (ev) => hub.broadcast({ type: 'generation', ...ev }),
    onError: (message) => {
      app.log.error(message);
      hub.broadcast({ type: 'error', message });
    },
  });
  listener.onMessage((msg) => engine.handleChatMessage(msg));
  listener.start();

  registerRoutes(app, { accounts, personas, agentService, senderPool, engine, hub });

  // Localhost only — the dashboard has no auth by design.
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
  app.log.info(`Target channel: #${config.TARGET_CHANNEL}`);
  app.log.info(`AI personas: ${agentService.enabled ? 'enabled' : 'disabled (no Azure config)'}`);

  const shutdown = async (): Promise<void> => {
    await engine.stop();
    senderPool.disconnectAll();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
