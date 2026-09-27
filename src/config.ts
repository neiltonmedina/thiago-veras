import 'dotenv/config';
import { z } from 'zod';

// Modo simulação: valida fluxos localmente sem WhatsApp real nem Gemini real.
// Setar SIMULATE=1 antes de rodar (ver `npm run simulate`).
const isSimulate = process.env.SIMULATE === '1';
if (isSimulate) {
  process.env.EVOLUTION_API_URL ??= 'http://mock.local';
  process.env.EVOLUTION_API_KEY ??= 'simulate-mock-key-1234567890';
  process.env.EVOLUTION_INSTANCE ??= 'mock';
  process.env.GEMINI_API_KEY ??= 'simulate-mock-gemini-key-1234567890';
  process.env.SUPPORT_PHONE ??= '5586999999999';
  process.env.MEDIA_BASE_URL ??= 'http://mock.local/media';
}

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(8),
  EVOLUTION_INSTANCE: z.string().min(1),
  GEMINI_API_KEY: z.string().min(10),
  SUPPORT_PHONE: z.string().regex(/^\d{12,13}$/, 'formato esperado: 5586999999999'),
  MEDIA_BASE_URL: z.string().url(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Configuração inválida no .env:');
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${errors?.join(', ')}`);
  }
  process.exit(1);
}

const env = parsed.data;

export const config = {
  simulate: isSimulate,
  port: env.PORT,
  evolution: {
    baseUrl: env.EVOLUTION_API_URL.replace(/\/$/, ''),
    apiKey: env.EVOLUTION_API_KEY,
    instance: env.EVOLUTION_INSTANCE,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
  },
  supportPhone: env.SUPPORT_PHONE,
  mediaBaseUrl: env.MEDIA_BASE_URL.replace(/\/$/, ''),
};
