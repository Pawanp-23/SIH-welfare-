/**
 * Server-sent events hub.
 *
 * Command dashboards are watched, not refreshed. When a check-in raises a
 * welfare flag, the commander's screen should show it without anyone pressing
 * anything — so alerts are pushed over SSE rather than polled.
 *
 * SSE over WebSocket on purpose: the traffic is one-directional, it survives
 * corporate proxies that eat WebSocket upgrades, and the browser reconnects on
 * its own. On a college network the day of a demo, that last property is worth
 * more than any protocol elegance.
 */

import type { Response } from 'express';

export type SaharaEvent =
  | { type: 'assessment.created'; payload: Record<string, unknown> }
  | { type: 'case.opened'; payload: Record<string, unknown> }
  | { type: 'case.updated'; payload: Record<string, unknown> }
  | { type: 'alert.raised'; payload: Record<string, unknown> }
  | { type: 'intervention.actioned'; payload: Record<string, unknown> }
  | { type: 'system.reset'; payload: Record<string, unknown> }
  | { type: 'heartbeat'; payload: Record<string, unknown> };

interface Client {
  id: number;
  res: Response;
  /** roles this connection is allowed to receive events for */
  role: string;
  unitId?: string;
}

const clients = new Map<number, Client>();
let nextId = 1;

/** Events are replayed to a reconnecting client via Last-Event-ID. */
const ring: Array<{ id: number; event: SaharaEvent }> = [];
const RING_SIZE = 100;

export function subscribe(res: Response, role: string, unitId?: string, lastEventId?: number): number {
  const id = nextId++;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this, nginx and friends buffer the stream into uselessness.
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);

  clients.set(id, { id, res, role, unitId });

  // Replay anything the client missed while disconnected.
  if (lastEventId !== undefined) {
    for (const item of ring) {
      if (item.id > lastEventId && permitted(item.event, role)) {
        write(res, item.id, item.event);
      }
    }
  }

  res.on('close', () => {
    clients.delete(id);
  });

  return id;
}

/**
 * Privacy gate on the wire, not just in the UI.
 *
 * A personnel-role connection must never receive another individual's alert,
 * so filtering happens before the bytes leave the process rather than being
 * left to the client to respect.
 */
function permitted(event: SaharaEvent, role: string): boolean {
  if (role === 'personnel') return event.type === 'heartbeat';
  if (role === 'welfare_officer') return event.type !== 'system.reset';
  return true;
}

function write(res: Response, id: number, event: SaharaEvent): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

let eventSeq = 0;

export function emit(event: SaharaEvent): void {
  const id = ++eventSeq;
  ring.push({ id, event });
  if (ring.length > RING_SIZE) ring.shift();

  for (const client of clients.values()) {
    if (!permitted(event, client.role)) continue;
    try {
      write(client.res, id, event);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function connectionCount(): number {
  return clients.size;
}

// A comment frame every 25s keeps intermediaries from reaping an idle stream.
const heartbeat = setInterval(() => {
  for (const client of clients.values()) {
    try {
      client.res.write(`: keep-alive ${Date.now()}\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}, 25_000);
heartbeat.unref?.();
