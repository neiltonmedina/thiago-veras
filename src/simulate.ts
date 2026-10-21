/**
 * Modo simulação — testa fluxos do bot sem chip, Gemini nem Efí reais.
 * Roda com: `npm run simulate`
 *
 * Cada cenário simula uma conversa. Os envios da Evolution API viram
 * console.log, a classificação usa o fallback por keyword, o Pix usa um
 * provedor falso e o SQLite roda em memória (cada rodada começa limpa).
 *
 * Um passo pode ser uma mensagem do cliente (string) ou uma ação do sistema
 * (pagar o Pix, rodar o job de expiração, ação do painel...).
 */
import { handleMessage } from './conversation/handler.js';
import { resetState } from './conversation/state.js';
import { mockPay } from './pix/provider.js';
import * as store from './reservations/store.js';
import { pollPayments, expireAndNotify, blockDates, confirmManually } from './reservations/lifecycle.js';

const HR = '─'.repeat(72);

type Action = { label: string; run: () => Promise<void> };
type Step = string | Action;
type Scenario = { name: string; from: string; steps: Step[] };

/** Paga o Pix da reserva mais recente do número informado. */
function pay(phone: string): Action {
  return {
    label: `cliente ${phone} paga o Pix no app do banco`,
    run: async () => {
      const r = store.listAwaitingPayment(Date.now()).filter(x => x.clientPhone === phone).pop();
      if (!r?.pixTxid) throw new Error(`nenhum Pix em aberto pra ${phone}`);
      mockPay(r.pixTxid);
    },
  };
}

const poll: Action = { label: 'job de pagamentos roda (a cada 1 min)', run: async () => { await pollPayments(); } };

/** Simula 31 minutos passando: vence as pré-reservas em aberto. */
const timePasses: Action = {
  label: 'passam 31 minutos (job de expiração roda)',
  run: async () => {
    const later = Date.now() + 31 * 60 * 1000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      await expireAndNotify();
    } finally {
      Date.now = realNow;
    }
  },
};

function check(label: string, assertion: () => boolean): Action {
  return {
    label: `verifica: ${label}`,
    run: async () => {
      if (!assertion()) throw new Error(`falhou: ${label}`);
      console.log('  ✔️  ok');
    },
  };
}

function latestOf(phone: string): store.Reservation | null {
  const all = store.listForAdmin('2000-01-01').filter(r => r.clientPhone === phone);
  return all.sort((a, b) => b.id - a.id)[0] ?? null;
}

const SCENARIOS: Scenario[] = [
  { name: 'Fluxo 1 — Saudação → escolha por código', from: '5586988880001', steps: ['oi', 'c02'] },
  { name: 'Fluxo 2 — Escolha direta por nome da casa', from: '5586988880002', steps: ['recanto das dunas'] },
  { name: 'Fluxo 3 — Local em linguagem natural', from: '5586988880003', steps: ['tem alguma casa em pedra do sal?'] },
  { name: 'Fluxo 4 — Pedido de atendente com saudação junto', from: '5586988880004', steps: ['oi, queria falar com uma pessoa'] },
  { name: 'Fluxo 5 — Casa não encontrada', from: '5586988880005', steps: ['casa em Fernando de Noronha'] },
  { name: 'Fluxo 6 — Códigos em formatos variados', from: '5586988880006', steps: ['01', 'C1', 'c 03'] },

  // ============ Fase 2 — Reserva ============
  {
    name: 'Fluxo 7 — Reserva completa com Pix do sinal',
    from: '5586988880007',
    steps: ['c01', 'quero reservar de 15/12 a 18/12', 'sim', 'João Silva, 529.982.247-25'],
  },
  {
    name: 'Fluxo 8 — Reservar sem data (bot pergunta)',
    from: '5586988880008',
    steps: ['recanto das dunas', 'quero reservar', '20/12 a 22/12', 'sim', 'Maria Souza, 98765432100'],
  },
  {
    name: 'Fluxo 9 — Data por extenso',
    from: '5586988880009',
    steps: ['c03', '10 a 12 de novembro', 'sim', 'Carlos Pereira 11144477735'],
  },
  { name: 'Fluxo 10 — Cliente desiste na confirmação', from: '5586988880010', steps: ['c04', '5/11 a 7/11', 'não'] },
  {
    name: 'Fluxo 11 — Datas ilegíveis, bot pede de novo',
    from: '5586988880011',
    steps: ['c02', 'quero reservar', 'sei lá, umas datas aí', '3/12 a 5/12', 'sim', 'Ana Lima, 22233344405'],
  },
  {
    name: 'Fluxo 12 — Conflito: outra pessoa tenta datas já reservadas',
    from: '5586988880012',
    steps: ['c01', '16/12 a 17/12'],
  },

  // ============ Fase 3 — Pix ============
  {
    name: 'Fluxo 13 — CPF inválido, depois válido',
    from: '5586988880013',
    steps: ['c05', '25/12 a 28/12', 'sim', 'Pedro Alves, 12345678900', 'Pedro Alves, 12345678909'],
  },
  {
    name: 'Fluxo 14 — "Paguei" antes do Pix cair, depois paga de verdade',
    from: '5586988880013',
    steps: [
      'paguei',
      pay('5586988880013'),
      'paguei',
      check('reserva confirmada e paga', () => {
        const r = latestOf('5586988880013');
        return r?.status === 'confirmed' && r.paidAt != null;
      }),
      'já paguei',
    ],
  },
  {
    name: 'Fluxo 15 — Pagamento confirmado pelo job automático',
    from: '5586988880007',
    steps: [
      pay('5586988880007'),
      poll,
      check('reserva do João confirmada pelo job', () => latestOf('5586988880007')?.status === 'confirmed'),
      poll,
      check('job não confirma duas vezes', () => latestOf('5586988880007')?.status === 'confirmed'),
    ],
  },
  {
    name: 'Fluxo 16 — Pré-reserva expira; pagamento atrasado com data livre confirma',
    from: '5586988880008',
    steps: [
      timePasses,
      check('reserva da Maria expirou', () => latestOf('5586988880008')?.status === 'expired'),
      pay('5586988880008'),
      poll,
      check('pagamento atrasado confirmou', () => latestOf('5586988880008')?.status === 'confirmed'),
    ],
  },
  {
    name: 'Fluxo 17 — Expira, outro cliente pega a data, pagamento atrasado vira conflito',
    from: '5586988880017',
    steps: [
      'c04', '8/12 a 10/12', 'sim', 'Lucas Rocha, 33344455508',
      timePasses,
      { label: 'outro cliente começa', run: async () => resetState('5586988880018') },
    ],
  },
  {
    name: 'Fluxo 17b — Segundo cliente reserva as mesmas datas',
    from: '5586988880018',
    steps: [
      'c04', '8/12 a 10/12', 'sim', 'Bruna Dias, 44455566619',
      pay('5586988880017'),
      poll,
      check('primeira reserva NÃO foi confirmada (conflito)', () => {
        const r = latestOf('5586988880017');
        return r?.status === 'expired' && r.paidAt != null;
      }),
    ],
  },

  // ============ Painel ============
  {
    name: 'Fluxo 18 — Thiago bloqueia datas no painel; bot respeita o bloqueio',
    from: '5586988880019',
    steps: [
      {
        label: 'painel: bloquear C03 de 20/12 a 27/12 (Airbnb)',
        run: async () => {
          const year = new Date().getMonth() >= 11 && new Date().getDate() > 20 ? new Date().getFullYear() + 1 : new Date().getFullYear();
          const res = await blockDates({ houseCode: 'C03', checkInIso: `${year}-12-20`, checkOutIso: `${year}-12-27`, note: 'Airbnb' });
          console.log(`  📋 ${res.message}`);
          if (!res.ok) throw new Error(res.message);
        },
      },
      'c03',
      '22/12 a 24/12',
    ],
  },
  {
    name: 'Fluxo 19 — Thiago confirma manualmente pelo painel',
    from: '5586988880011',
    steps: [
      {
        label: 'painel: confirmar reserva da Ana',
        run: async () => {
          const r = latestOf('5586988880011');
          const res = await confirmManually(r!.id);
          console.log(`  📋 ${res.message}`);
          if (!res.ok) throw new Error(res.message);
        },
      },
    ],
  },
];

async function runScenario(s: Scenario): Promise<void> {
  console.log(`\n${HR}\n▶ ${s.name}\n${HR}`);
  for (const step of s.steps) {
    if (typeof step === 'string') {
      console.log(`\n  👤 CLIENTE (${s.from}) → ${step}`);
      await handleMessage({ from: s.from, text: step, timestamp: new Date() });
    } else {
      console.log(`\n  ⚙️  ${step.label}`);
      await step.run();
    }
  }
}

async function main(): Promise<void> {
  console.log(`\n🧪 Simulação — ${SCENARIOS.length} cenários\n`);
  let failed = 0;
  for (const s of SCENARIOS) {
    try {
      await runScenario(s);
    } catch (err) {
      failed++;
      console.error(`\n❌ Cenário "${s.name}" falhou:`, err);
    }
  }
  console.log(`\n${HR}\n${failed ? `❌ ${failed} cenário(s) falharam.` : '✅ Todos os cenários passaram.'}\n${HR}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('erro fatal:', err);
  process.exit(1);
});
