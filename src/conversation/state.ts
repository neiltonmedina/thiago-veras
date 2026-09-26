import type { ConversationState } from '../types.js';

/**
 * Estado em memória. Bom pra Fase 1 (5 casas, volume baixo).
 * Fase 2 vai migrar pra Supabase pra sobreviver a restart.
 */
const store = new Map<string, { state: ConversationState; touchedAt: number }>();

const TTL_MS = 60 * 60 * 1000; // 1h de inatividade zera pra idle

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
