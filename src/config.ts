import 'dotenv/config';
import { z } from 'zod';

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
