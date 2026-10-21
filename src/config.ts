import 'dotenv/config';
import { z } from 'zod';

// Modo simulação: valida fluxos localmente sem WhatsApp, Gemini nem Efí reais.
// Setar SIMULATE=1 antes de rodar (ver `npm run simulate`).
const isSimulate = process.env.SIMULATE === '1';
if (isSimulate) {
  process.env.EVOLUTION_API_URL ??= 'http://mock.local';
  process.env.EVOLUTION_API_KEY ??= 'simulate-mock-key-1234567890';
  process.env.EVOLUTION_INSTANCE ??= 'mock';
  process.env.GEMINI_API_KEY ??= 'simulate-mock-gemini-key-1234567890';
  process.env.SUPPORT_PHONE ??= '5586999999999';
  process.env.MEDIA_BASE_URL ??= 'http://mock.local/media';
  process.env.DB_PATH ??= ':memory:';
  process.env.ADMIN_PASSWORD ??= 'simulate';
}

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(8),
  EVOLUTION_INSTANCE: z.string().min(1),
  GEMINI_API_KEY: z.string().min(10),
  SUPPORT_PHONE: z.string().regex(/^\d{12,13}$/, 'formato esperado: 5586999999999'),
  MEDIA_BASE_URL: z.string().url(),
  DB_PATH: z.string().default('./data/thiago-veras.db'),
  WEBHOOK_TOKEN: optional,

  ADMIN_USER: z.string().default('thiago'),
  ADMIN_PASSWORD: optional,

  DEPOSIT_PERCENT: z.coerce.number().int().min(1).max(100).default(50),

  EFI_CLIENT_ID: optional,
  EFI_CLIENT_SECRET: optional,
  EFI_CERT_PATH: optional,
  EFI_CERT_PASSWORD: z.string().default(''),
  EFI_PIX_KEY: optional,
  EFI_SANDBOX: z.enum(['true', 'false']).default('false'),
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

const efiFields = [env.EFI_CLIENT_ID, env.EFI_CLIENT_SECRET, env.EFI_CERT_PATH, env.EFI_PIX_KEY];
const efiConfigured = efiFields.every(Boolean);
if (!efiConfigured && efiFields.some(Boolean)) {
  console.error('❌ Pix: preencha EFI_CLIENT_ID, EFI_CLIENT_SECRET, EFI_CERT_PATH e EFI_PIX_KEY juntos (ou nenhum).');
  process.exit(1);
}

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
  dbPath: env.DB_PATH,
  webhookToken: env.WEBHOOK_TOKEN,
  admin: env.ADMIN_PASSWORD ? { user: env.ADMIN_USER, password: env.ADMIN_PASSWORD } : null,
  depositPercent: env.DEPOSIT_PERCENT,
  // Pix fica ativo com credenciais da Efí completas, ou em simulação (com mock)
  pix: isSimulate
    ? { mode: 'mock' as const }
    : efiConfigured
      ? {
          mode: 'efi' as const,
          clientId: env.EFI_CLIENT_ID!,
          clientSecret: env.EFI_CLIENT_SECRET!,
          certPath: env.EFI_CERT_PATH!,
          certPassword: env.EFI_CERT_PASSWORD,
          pixKey: env.EFI_PIX_KEY!,
          sandbox: env.EFI_SANDBOX === 'true',
        }
      : null,
};
