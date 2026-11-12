import { useEffect, useRef } from 'react';
import type { ServerEvent } from './types';

/** Connects to the backend event stream with automatic reconnect. */
export function useWebSocket(onEvent: (ev: ServerEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let closed = false;

    const connect = (): void => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/ws`);
      socket.onmessage = (ev) => {
        try {
          handler.current(JSON.parse(ev.data) as ServerEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (!closed) retryTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);
}
