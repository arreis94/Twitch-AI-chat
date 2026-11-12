import type { WebSocket } from 'ws';

export type ServerEvent =
  | { type: 'chat'; msg: unknown }
  | { type: 'account_status'; userId: string; connected: boolean; queueDepth: number }
  | { type: 'scenario_status'; running: boolean; name?: string; mode?: string; sentCount: number }
  | { type: 'generation'; accountId: string; personaName: string; text: string; latencyMs: number }
  | { type: 'error'; message: string };

export class WsHub {
  private clients = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }
}
