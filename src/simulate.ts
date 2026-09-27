/**
 * Modo simulação — testa fluxos do bot sem chip nem Gemini reais.
 * Roda com: `npm run simulate`
 *
 * Cada cenário simula uma conversa completa. Os "envios" da Evolution API
 * viram console.log; a classificação usa fallback por keyword; o SQLite
 * roda em memória (:memory:), então cada rodada começa limpo.
 *
 * Adicione novos cenários no array SCENARIOS.
 */
import { handleMessage } from './conversation/handler.js';
import { resetState } from './conversation/state.js';

const HR = '─'.repeat(72);

type Scenario = {
  name: string;
  from: string;
  messages: string[];
};

const SCENARIOS: Scenario[] = [
  {
    name: 'Fluxo 1 — Saudação → escolha por código → dados livres',
    from: '5586988880001',
    messages: ['oi', 'c02'],
  },
  {
    name: 'Fluxo 2 — Escolha direta por nome da casa',
    from: '5586988880002',
    messages: ['recanto das dunas'],
  },
  {
    name: 'Fluxo 3 — Local em linguagem natural',
    from: '5586988880003',
    messages: ['tem alguma casa em pedra do sal?'],
  },
  {
    name: 'Fluxo 4 — Pedido de atendente com saudação junto',
    from: '5586988880004',
    messages: ['oi, queria falar com uma pessoa'],
  },
  {
    name: 'Fluxo 5 — Casa não encontrada',
    from: '5586988880005',
    messages: ['casa em Fernando de Noronha'],
  },
  {
    name: 'Fluxo 6 — Códigos em formatos variados',
    from: '5586988880006',
    messages: ['01', 'C1', 'c 03'],
  },
  // ============ Fase 2 — Reserva ============
  {
    name: 'Fluxo 7 — Reserva completa (código → datas → sim → dados)',
    from: '5586988880007',
    messages: [
      'c01',
      'quero reservar de 15/12 a 18/12',
      'sim',
      'João Silva, 12345678900',
    ],
  },
  {
    name: 'Fluxo 8 — Escolhe casa, pede reservar sem data (bot pergunta)',
    from: '5586988880008',
    messages: [
      'recanto das dunas',
      'quero reservar',
      '20/12 a 22/12',
      'sim',
      'Maria Souza, 98765432100',
    ],
  },
  {
    name: 'Fluxo 9 — Formato de data por extenso',
    from: '5586988880009',
    messages: [
      'c03',
      '10 a 12 de novembro',
      'sim',
      'Carlos Pereira 11122233344',
    ],
  },
  {
    name: 'Fluxo 10 — Cliente desiste na confirmação',
    from: '5586988880010',
    messages: [
      'c04',
      '5/11 a 7/11',
      'não',
    ],
  },
  {
    name: 'Fluxo 11 — Data inválida (passado), depois válida',
    from: '5586988880011',
    messages: [
      'c01',
      '1/1 a 3/1',           // se estamos em set/2026, 1/1 já passou → assume 2027
      'ei que datas são essas', // sanity check textual
    ],
  },
  {
    name: 'Fluxo 12 — Datas ilegíveis, bot pede de novo',
    from: '5586988880012',
    messages: [
      'c02',
      'quero reservar',
      'sei lá, umas datas aí',
      '15/12 a 18/12',
      'sim',
      'Ana Lima, 22233344455',
    ],
  },
  {
    name: 'Fluxo 13 — Conflito: mesma casa+data em duas conversas',
    from: '5586988880013',
    messages: [
      'c05',
      '25/12 a 28/12',
      'sim',
      'Pedro Alves, 33344455566',
    ],
  },
  {
    name: 'Fluxo 13b — Outra pessoa tentando mesma casa e datas',
    from: '5586988880014',
    messages: [
      'c05',
      '25/12 a 28/12',
    ],
  },
];

async function runScenario(s: Scenario): Promise<void> {
  console.log(`\n${HR}\n▶ ${s.name}\n${HR}`);
  resetState(s.from);
  for (const text of s.messages) {
    console.log(`\n  👤 CLIENTE (${s.from}) → ${text}`);
    await handleMessage({ from: s.from, text, timestamp: new Date() });
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
  process.exit(process.exitCode ?? 0);
}

main().catch(err => {
  console.error('erro fatal:', err);
  process.exit(1);
});
