import type { ConversationState } from '../types.js';

/**
 * Estado em memória. TTL de 1h — depois disso a conversa reseta pra idle.
 * Reservas confirmadas ficam no SQLite; o estado aqui é só o "onde parou" da conversa.
 */
const store = new Map<string, { state: ConversationState; touchedAt: number }>();

const TTL_MS = 60 * 60 * 1000;

export function getState(from: string): ConversationState {
  const entry = store.get(from);
  if (!entry) return { step: 'idle' };
  if (Date.now() - entry.touchedAt > TTL_MS) {
    store.delete(from);
    return { step: 'idle' };
  }
  return entry.state;
}

export function setState(from: string, state: ConversationState): void {
  store.set(from, { state, touchedAt: Date.now() });
}

export function resetState(from: string): void {
  store.delete(from);
}
