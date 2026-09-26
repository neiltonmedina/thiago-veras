import type { House } from '../types.js';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tenta bater a `query` do usuário em uma casa do catálogo.
 * Ordem: código exato → nome → keywords/cidade → substring longa.
 */
export function matchHouse(query: string, catalog: House[]): House | null {
  const q = normalize(query);
  if (!q) return null;

  // 1. Match por código: "C01", "c1", "01", "1"
  const numMatch = q.match(/^c?\s*(\d{1,3})$/);
  if (numMatch) {
    const num = numMatch[1]!.padStart(2, '0');
    const byCode = catalog.find(h => normalize(h.code).endsWith(num));
    if (byCode) return byCode;
  }

  // 2. Match por nome (bidirecional)
  const byName = catalog.find(h => {
    const n = normalize(h.name);
    return n === q || n.includes(q) || q.includes(n);
  });
  if (byName) return byName;

  // 3. Score por keywords + cidade
  const scored = catalog.map(h => {
    const terms = [normalize(h.city), ...h.keywords.map(normalize)];
    let score = 0;
    for (const term of terms) {
      if (!term) continue;
      if (q === term) score += 3;
      else if (q.includes(term) && term.length >= 3) score += 2;
      else if (term.includes(q) && q.length >= 3) score += 1;
    }
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score && scored[0].score > 0 ? scored[0].h : null;
}
