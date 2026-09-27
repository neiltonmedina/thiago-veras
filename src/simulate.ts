/**
 * Modo simulação — testa o fluxo do bot sem chip de WhatsApp real
 * e sem chave do Gemini. Roda com: `npm run simulate`
 *
 * O que faz:
 *   1. Roda cada mensagem do roteiro abaixo pelo handleMessage()
 *   2. As chamadas de envio da Evolution API viram console.log
 *   3. A classificação de intenção usa o fallback por keyword (não Gemini)
 *
 * Uso pra testar novos casos:
 *   - Adicione linhas ao array SCRIPT
 *   - Cada linha vira uma mensagem WhatsApp do "cliente"
 *   - O log mostra o que o bot responderia
 */
import { handleMessage } from './conversation/handler.js';
import { resetState } from './conversation/state.js';

const CLIENT = '5586988887777'; // número fictício
const HR = '─'.repeat(72);

type Scenario = { name: string; messages: string[] };

const SCENARIOS: Scenario[] = [
  {
    name: 'Fluxo 1 — Saudação → escolha por código → pedido de reserva',
    messages: ['oi', 'c02', 'quero reservar de 15 a 18 de dezembro'],
  },
  {
    name: 'Fluxo 2 — Escolha direta por nome da casa',
    messages: ['recanto das dunas'],
  },
  {
    name: 'Fluxo 3 — Escolha por local ("praia") em linguagem natural',
    messages: ['tem alguma casa em pedra do sal?'],
  },
  {
    name: 'Fluxo 4 — Pedido de atendente humano',
    messages: ['oi, queria falar com uma pessoa'],
  },
  {
    name: 'Fluxo 5 — Casa não encontrada',
    messages: ['casa em Fernando de Noronha'],
  },
  {
    name: 'Fluxo 6 — Código com formatos variados',
    messages: ['01', 'C1', 'c 03'],
  },
];

async function runScenario(s: Scenario): Promise<void> {
  console.log(`\n${HR}\n▶ ${s.name}\n${HR}`);
  resetState(CLIENT);

  for (const text of s.messages) {
    console.log(`\n  👤 CLIENTE → ${text}`);
    await handleMessage({ from: CLIENT, text, timestamp: new Date() });
  }
}

async function main(): Promise<void> {
  console.log(`\n🧪 Simulação do Anfitrião — testando ${SCENARIOS.length} cenários\n`);

  for (const s of SCENARIOS) {
    try {
      await runScenario(s);
    } catch (err) {
      console.error(`\n❌ Cenário "${s.name}" falhou:`, err);
      process.exitCode = 1;
    }
  }

  console.log(`\n${HR}\n✅ Simulação concluída.\n${HR}\n`);
}

main().catch(err => {
  console.error('erro fatal:', err);
  process.exit(1);
});
