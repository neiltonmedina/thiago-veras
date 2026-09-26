import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

export type Intent =
  | { type: 'greeting' }
  | { type: 'list_houses' }
  | { type: 'select_house'; query?: string }
  | { type: 'want_reserve'; dateHint?: string }
  | { type: 'want_human' }
  | { type: 'unknown' };

const SYSTEM = `Você classifica a intenção de uma mensagem WhatsApp de um cliente interessado
em alugar casa de temporada no litoral do Piauí. Responda APENAS em JSON válido, sem
texto extra, sem markdown.

Formato: {"type":"<tipo>","query":"<opcional>","dateHint":"<opcional>"}

Tipos possíveis:
- "greeting": saudação simples (oi, olá, boa tarde, tudo bem)
- "list_houses": pede lista/opções/casas disponíveis/o que tem
- "select_house": interesse em uma casa específica (código C01/C02, nome, ou local)
- "want_reserve": quer reservar, agendar, marcar, alugar para datas específicas
- "want_human": quer falar com pessoa, atendente, dono, humano
- "unknown": não se enquadra em nenhum dos anteriores

Quando "select_house", preencha "query" com o termo relevante da mensagem.
Quando "want_reserve", preencha "dateHint" se datas forem mencionadas.

Exemplos:
"oi" → {"type":"greeting"}
"quais opções?" → {"type":"list_houses"}
"c02" → {"type":"select_house","query":"c02"}
"me manda a casa em pedra do sal" → {"type":"select_house","query":"pedra do sal"}
"quero reservar 15 a 18 de dezembro" → {"type":"want_reserve","dateHint":"15 a 18 de dezembro"}
"quero falar com alguém" → {"type":"want_human"}
"pode reservar essa aí" → {"type":"want_reserve"}`;

export async function classify(text: string): Promise<Intent> {
  try {
    const resp = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: `${SYSTEM}\n\nMensagem do cliente: "${text}"` }] },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    const raw = resp.response.text().trim();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as Intent;
    }
    return { type: 'unknown' };
  } catch (err) {
    console.warn('[gemini] falhou, usando fallback por keyword:', (err as Error).message);
    return fallbackClassify(text);
  }
}

function fallbackClassify(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (/^(oi|ola|olá|hey|bom dia|boa tarde|boa noite|tudo bem)/i.test(t)) {
    return { type: 'greeting' };
  }
  if (/(atendente|humano|pessoa|falar com|dono|proprietar)/i.test(t)) {
    return { type: 'want_human' };
  }
  if (/(reserv|agend|marc|alug)/i.test(t)) {
    return { type: 'want_reserve' };
  }
  if (/(lista|opcoes|opções|casas|disponivel|disponíveis|o que tem)/i.test(t)) {
    return { type: 'list_houses' };
  }
  return { type: 'select_house', query: t };
}
