import type { WebSocket } from 'ws';
import type { RealtimeEvent } from '@reomi/shared';

/**
 * In-process fan-out for live updates. Channels look like `room:<id>`, `thread:<id>` and
 * `user:<id>`. Render's free plan runs one instance, so memory is enough; with several instances
 * this would move to Postgres LISTEN/NOTIFY behind the same interface.
 */
export class RealtimeHub {
  private readonly channels = new Map<string, Set<WebSocket>>();

  subscribe(channel: string, socket: WebSocket) {
    let sockets = this.channels.get(channel);
    if (!sockets) {
      sockets = new Set();
      this.channels.set(channel, sockets);
    }
    sockets.add(socket);
  }

  unsubscribe(channel: string, socket: WebSocket) {
    const sockets = this.channels.get(channel);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.channels.delete(channel);
  }

  drop(socket: WebSocket) {
    for (const [channel, sockets] of this.channels) {
      sockets.delete(socket);
      if (sockets.size === 0) this.channels.delete(channel);
    }
  }

  publish(channel: string, event: RealtimeEvent) {
    const sockets = this.channels.get(channel);
    if (!sockets) return;
    const frame = JSON.stringify({ type: 'event', channel, event });
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    }
  }

  get size() {
    return this.channels.size;
  }
}

export const roomChannel = (roomId: string) => `room:${roomId}`;
export const threadChannel = (threadId: string) => `thread:${threadId}`;
export const userChannel = (userId: string) => `user:${userId}`;
