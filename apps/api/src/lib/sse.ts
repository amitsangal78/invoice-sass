import type { Response } from 'express';

export type SseEventType = 'invoice.updated' | 'invoice.paid' | 'payment.received' | 'reminder.sent';

export interface SseEvent {
  event: SseEventType;
  invoiceId: string;
  status?: string;
}

/**
 * In-memory per-instance connection registry. KNOWN LIMITATION, documented
 * deliberately (core-invoicing/design.md): the API runs multiple ECS tasks
 * behind an ALB, so a client connected to instance A won't see an event
 * published by a webhook handled on instance B. Acceptable for this
 * feature — a missed live update just means the next refresh/poll shows it,
 * not a correctness bug. Revisit with Redis pub/sub only if this gap
 * actually bothers users in practice; don't build it speculatively.
 */
const connections = new Map<string, Set<Response>>();

export function subscribeToWorkspaceEvents(workspaceId: string, res: Response): void {
  if (!connections.has(workspaceId)) connections.set(workspaceId, new Set());
  connections.get(workspaceId)!.add(res);

  res.on('close', () => {
    connections.get(workspaceId)?.delete(res);
  });
}

export function publishWorkspaceEvent(workspaceId: string, event: SseEvent): void {
  const subscribers = connections.get(workspaceId);
  if (!subscribers || subscribers.size === 0) return;

  const payload = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of subscribers) {
    res.write(payload);
  }
}
