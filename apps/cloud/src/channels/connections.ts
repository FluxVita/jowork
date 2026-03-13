/**
 * Connection tracker for desktop clients connected via WebSocket.
 * Tracks which users are online and provides message forwarding.
 * On reconnect, drains any queued tasks for the user.
 */

import { taskQueue } from './task-queue';

interface ConnectedClient {
  userId: string;
  connectedAt: Date;
  send: (data: unknown) => void;
}

class ConnectionTracker {
  private clients = new Map<string, ConnectedClient>();

  register(userId: string, send: (data: unknown) => void): void {
    this.clients.set(userId, { userId, connectedAt: new Date(), send });

    // Drain queued tasks for this user on reconnect
    const queued = taskQueue.drain(userId);
    if (queued.length > 0) {
      for (const task of queued) {
        try {
          send({
            type: 'queued_task',
            payload: { taskId: task.id, originalType: task.type, ...task.payload, source: task.source, queuedAt: task.queuedAt.toISOString() },
          });
        } catch {
          // If send fails immediately, re-enqueue
          taskQueue.enqueue(userId, { userId, type: task.type, payload: task.payload, source: task.source });
          break;
        }
      }
    }
  }

  unregister(userId: string): void {
    this.clients.delete(userId);
  }

  isOnline(userId: string): boolean {
    return this.clients.has(userId);
  }

  /**
   * Forward a message to a connected desktop client.
   * Returns true if the client is online and the message was sent.
   */
  forward(userId: string, message: { type: string; payload: unknown }): boolean {
    const client = this.clients.get(userId);
    if (!client) return false;

    try {
      client.send(message);
      return true;
    } catch {
      // Client disconnected unexpectedly
      this.clients.delete(userId);
      return false;
    }
  }

  getOnlineCount(): number {
    return this.clients.size;
  }
}

export const connections = new ConnectionTracker();
