import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { handleWebhook } from './whatsapp/webhook.js';
import { closeDb } from './db/index.js';
import { expireOldPending } from './reservations/service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'thiago-veras', ts: new Date().toISOString() });
});

app.post('/webhook/messages', handleWebhook);

// Serve mídias locais das casas em /media
app.use('/media', express.static(join(__dirname, '..', 'media'), {
  maxAge: '7d',
  index: false,
}));

// Job: expira pré-reservas vencidas a cada 5 min
const EXPIRE_INTERVAL_MS = 5 * 60 * 1000;
const expireTimer = setInterval(() => {
  const n = expireOldPending();
  if (n > 0) console.log(`[expire] ${n} pré-reserva(s) expiradas`);
}, EXPIRE_INTERVAL_MS);

const server = app.listen(config.port, () => {
  console.log(`✅ thiago-veras escutando em http://localhost:${config.port}`);
  console.log(`   webhook: POST /webhook/messages`);
  console.log(`   mídias:  GET /media/<arquivo>`);
  console.log(`   db:      ${config.dbPath}`);
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n[${signal}] encerrando...`);
  clearInterval(expireTimer);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // fallback caso conexões demorem a fechar
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
