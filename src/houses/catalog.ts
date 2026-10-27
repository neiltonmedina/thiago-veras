import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { House } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Em simulação usa as casas de exemplo (data.sample.json), que têm preços e fotos
// completos para os testes. CATALOG_PATH força outro arquivo, se necessário.
const DATA_PATH = process.env.CATALOG_PATH
  ?? join(__dirname, process.env.SIMULATE === '1' ? 'data.sample.json' : 'data.json');

let cache: House[] | null = null;
let cacheAt = 0;
const TTL_MS = 30_000; // recarrega a cada 30s pra facilitar dev

export async function getCatalog(): Promise<House[]> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const raw = await readFile(DATA_PATH, 'utf-8');
  cache = JSON.parse(raw) as House[];
  cacheAt = Date.now();
  return cache;
}

export function invalidateCatalog(): void {
  cache = null;
}
