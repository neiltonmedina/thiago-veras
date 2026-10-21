// Confere se cada foto/vídeo citado em src/houses/data.json existe em media/
// e cabe nos limites do WhatsApp. Uso: npm run check:media
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { House } from '../src/types.js';

const MB = 1024 * 1024;
const LIMITS = { photo: 5 * MB, video: 16 * MB };

const root = join(import.meta.dirname, '..');
const houses = JSON.parse(readFileSync(join(root, 'src/houses/data.json'), 'utf-8')) as House[];

let problems = 0;

function check(code: string, path: string, kind: 'photo' | 'video'): void {
  if (/^https?:\/\//i.test(path)) return;
  const full = join(root, 'media', path);
  try {
    const size = statSync(full).size;
    if (size > LIMITS[kind]) {
      problems++;
      console.log(`  ⚠️  ${code} ${path}: ${(size / MB).toFixed(1)} MB (máx ${LIMITS[kind] / MB} MB)`);
    } else {
      console.log(`  ✅ ${code} ${path}: ${(size / MB).toFixed(1)} MB`);
    }
  } catch {
    problems++;
    console.log(`  ❌ ${code} ${path}: arquivo não encontrado em media/`);
  }
}

for (const h of houses) {
  console.log(`\n${h.code} — ${h.name}`);
  if (h.photos.length === 0) {
    problems++;
    console.log('  ❌ nenhuma foto cadastrada');
  }
  for (const p of h.photos) check(h.code, p, 'photo');
  if (h.video) check(h.code, h.video, 'video');
}

console.log(problems ? `\n${problems} problema(s) encontrado(s).` : '\nTudo certo.');
process.exit(problems ? 1 : 0);
