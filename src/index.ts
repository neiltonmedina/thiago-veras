import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { handleWebhook } from './whatsapp/webhook.js';
import { closeDb } from './db/index.js';
import { expireAndNotify, pollPayments } from './reservations/lifecycle.js';
import { adminRouter } from './admin/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'thiago-veras', ts: new Date().toISOString() });
});

app.post('/webhook/messages', handleWebhook);

app.use('/admin', adminRouter);

// Mídias das casas (fotos/vídeos em ./media/<código>/)
app.use('/media', express.static(join(__dirname, '..', 'media'), {
  maxAge: '7d',
  index: false,
}));

function every(ms: number, name: string, job: () => Promise<unknown>): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return; // não sobrepõe se a rodada anterior ainda não terminou
    running = true;
    try {
      await job();
    } catch (err) {
      console.error(`[${name}] falhou:`, err);
    } finally {
      running = false;
    }
  }, ms);
}

const timers = [
  every(60_000, 'expire', async () => {
    const n = await expireAndNotify();
    if (n > 0) console.log(`[expire] ${n} pré-reserva(s) expirada(s)`);
  }),
  ...(config.pix ? [every(60_000, 'pix', pollPayments)] : []),
];

const server = app.listen(config.port, () => {
  console.log(`✅ thiago-veras escutando em http://localhost:${config.port}`);
  console.log(`   webhook: POST /webhook/messages${config.webhookToken ? ' (com token)' : ''}`);
  console.log(`   painel:  ${config.admin ? 'GET /admin' : 'desligado (defina ADMIN_PASSWORD)'}`);
  console.log(`   pix:     ${config.pix ? `${config.pix.mode}${config.pix.mode === 'efi' && config.pix.sandbox ? ' (sandbox)' : ''}, sinal ${config.depositPercent}%` : 'desligado (pagamento combinado com atendente)'}`);
  console.log(`   db:      ${config.dbPath}`);
});

function shutdown(signal: string): void {
  console.log(`\n[${signal}] encerrando...`);
  timers.forEach(clearInterval);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
