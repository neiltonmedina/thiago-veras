import 'dotenv/config';
import { z } from 'zod';

// Modo simulação: valida fluxos localmente sem WhatsApp, Gemini nem Efí reais.
// Setar SIMULATE=1 antes de rodar (ver `npm run simulate`).
const isSimulate = process.env.SIMULATE === '1';
if (isSimulate) {
  process.env.WHATSAPP_TOKEN ??= 'simulate-mock-token-1234567890';
  process.env.WHATSAPP_PHONE_NUMBER_ID ??= '100000000000000';
  process.env.WHATSAPP_VERIFY_TOKEN ??= 'simulate-verify-token';
  process.env.WHATSAPP_APP_SECRET ??= 'simulate-app-secret-1234567890';
  process.env.GEMINI_API_KEY ??= 'simulate-mock-gemini-key-1234567890';
  process.env.SUPPORT_PHONE ??= '5586999999999';
  process.env.MEDIA_BASE_URL ??= 'http://mock.local/media';
  process.env.DB_PATH ??= ':memory:';
  process.env.ADMIN_PASSWORD ??= 'simulate';
}

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  // Em produção o Caddy fica na frente; o backend só escuta localmente
  HOST: z.string().default('127.0.0.1'),

  // WhatsApp Cloud API (Meta). Ver README, seção "WhatsApp (Meta)".
  WHATSAPP_TOKEN: z.string().min(20),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/, 'só números (Phone number ID do painel da Meta)'),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_APP_SECRET: z.string().min(16),
  // Template aprovado pra avisar o atendente fora da janela de 24h (opcional)
  WHATSAPP_SUPPORT_TEMPLATE: optional,
  WHATSAPP_TEMPLATE_LANG: z.string().default('pt_BR'),
  GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),

  GEMINI_API_KEY: z.string().min(10),
  SUPPORT_PHONE: z.string().regex(/^\d{12,13}$/, 'formato esperado: 5586999999999'),
  MEDIA_BASE_URL: z.string().url(),
  DB_PATH: z.string().default('./data/thiago-veras.db'),

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
  host: env.HOST,
  whatsapp: {
    token: env.WHATSAPP_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    supportTemplate: env.WHATSAPP_SUPPORT_TEMPLATE,
    templateLang: env.WHATSAPP_TEMPLATE_LANG,
    graphBase: `https://graph.facebook.com/${env.GRAPH_API_VERSION}`,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
  },
  supportPhone: env.SUPPORT_PHONE,
  mediaBaseUrl: env.MEDIA_BASE_URL.replace(/\/$/, ''),
  dbPath: env.DB_PATH,
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
