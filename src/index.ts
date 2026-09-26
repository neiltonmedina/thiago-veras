import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { handleWebhook } from './whatsapp/webhook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'thiago-veras', ts: new Date().toISOString() });
});

app.post('/webhook/messages', handleWebhook);

// Serve mídias locais das casas em /media
// Em dev, coloque fotos/vídeos em ./media/<code>/*
app.use('/media', express.static(join(__dirname, '..', 'media'), {
  maxAge: '7d',
  index: false,
}));

app.listen(config.port, () => {
  console.log(`✅ thiago-veras escutando em http://localhost:${config.port}`);
  console.log(`   webhook: POST /webhook/messages`);
  console.log(`   mídias:  GET /media/<arquivo>`);
});
