import type { Reservation } from '../reservations/store.js';

export type AdminItem = {
  r: Reservation;
  houseName: string;
  clientName: string | null;
  checkIn: Date;
  checkOut: Date;
};

export type AdminView = {
  flash: { ok: boolean; text: string } | null;
  houses: { code: string; name: string }[];
  todayIso: string;
  pixMode: 'efi' | 'mock' | null;
  depositPercent: number;
  items: AdminItem[];
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents: number) => brl.format(cents / 100);
const day = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const weekday = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');

const STATUS: Record<Reservation['status'], { label: string; cls: string }> = {
  pending: { label: 'Datas seguras, aguardando pagamento', cls: 'warn' },
  confirmed: { label: 'Confirmada', cls: 'ok' },
  expired: { label: 'Expirada', cls: 'muted' },
  cancelled: { label: 'Cancelada', cls: 'muted' },
};

function card(item: AdminItem): string {
  const { r } = item;
  const st = r.source === 'manual' ? { label: 'Bloqueio manual', cls: 'block' } : STATUS[r.status];
  const nights = r.nights === 1 ? '1 diária' : `${r.nights} diárias`;
  const left = r.status === 'pending' && r.expiresAt ? Math.max(0, Math.round((r.expiresAt - Date.now()) / 60000)) : null;

  const payment = r.source === 'manual' ? '' : [
    r.totalCents > 0 ? `<span>Total ${money(r.totalCents)}</span>` : '',
    r.depositCents != null
      ? `<span>${r.paidAt ? '✅' : '⏳'} Sinal ${money(r.depositCents)} ${r.paidAt ? 'pago' : 'via Pix'}</span>`
      : '',
  ].join('');

  const contact = r.clientPhone
    ? `<a href="https://wa.me/${esc(r.clientPhone)}" target="_blank" rel="noopener">WhatsApp ${esc(r.clientPhone)}</a>`
    : `<span class="note" style="margin:0">Sem WhatsApp informado, o cliente chama você pela conversa.</span>`;
  const origin = r.source === 'site' ? '<span class="note" style="margin:0">Pedido feito pelo site</span>' : '';
  const guests = r.guests ? `<span class="note" style="margin:0">${r.guests} ${r.guests === 1 ? 'pessoa' : 'pessoas'}</span>` : '';

  const who = r.source === 'manual'
    ? `<p class="note">${esc(r.note)}</p>`
    : `<p class="who">
        <strong>${esc(item.clientName ?? 'Cliente sem nome')}</strong>
        ${contact}${guests}${origin}
      </p>${r.note ? `<p class="note">⚠️ ${esc(r.note)}</p>` : ''}`;

  const canConfirm = r.source !== 'manual' && (r.status === 'pending' || r.status === 'expired');
  const canCancel = r.status === 'pending' || r.status === 'confirmed';
  const cancelLabel = r.source === 'manual' ? 'Liberar datas' : 'Cancelar';

  const actions = [
    canConfirm ? `<form method="post" action="/admin/reservations/${r.id}/confirm">
        <button class="primary" type="submit">Confirmar</button></form>` : '',
    canCancel ? `<form method="post" action="/admin/reservations/${r.id}/cancel"
        onsubmit="return confirm('${cancelLabel} a reserva #${r.id}?')">
        <button class="ghost" type="submit">${cancelLabel}</button></form>` : '',
  ].join('');

  return `<article class="card">
    <header>
      <span class="id">#${r.id}</span>
      <span class="pill ${st.cls}">${st.label}</span>
    </header>
    <h3>${esc(r.houseCode)} · ${esc(item.houseName)}</h3>
    <p class="dates">${weekday(item.checkIn)} ${day(item.checkIn)} → ${weekday(item.checkOut)} ${day(item.checkOut)} <span>· ${nights}</span></p>
    ${left !== null ? `<p class="note">⏳ Datas seguras por mais ${left >= 60 ? `${Math.floor(left / 60)}h${String(left % 60).padStart(2, '0')}` : `${left} min`}</p>` : ''}
    ${who}
    ${payment ? `<p class="pay">${payment}</p>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </article>`;
}

function section(title: string, items: AdminItem[], empty: string): string {
  return `<section>
    <h2>${title} <span class="count">${items.length}</span></h2>
    ${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : `<p class="empty">${empty}</p>`}
  </section>`;
}

export function renderPage(v: AdminView): string {
  const awaiting = v.items.filter(i => i.r.status === 'pending');
  const confirmed = v.items.filter(i => i.r.status === 'confirmed' && i.r.checkOut >= v.todayIso);
  const history = v.items.filter(i => !awaiting.includes(i) && !confirmed.includes(i));

  const pixInfo = v.pixMode === 'efi'
    ? `Pix automático ligado · sinal de ${v.depositPercent}%`
    : v.pixMode === 'mock'
      ? 'Pix em modo simulação'
      : 'Pix automático desligado — confirme os pagamentos manualmente';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Painel de reservas</title>
<style>
  :root {
    --bg: #f4f6f5; --surface: #fff; --ink: #14302f; --ink-2: #557370; --line: #dde5e3;
    --accent: #0b7a75; --accent-ink: #fff;
    --ok-bg: #dff3e6; --ok: #1d6b3a; --warn-bg: #fdefd2; --warn: #8a5300;
    --muted-bg: #eceff0; --muted: #5d6b6d; --block-bg: #e3e9f7; --block: #2f4a8a;
    --err-bg: #fbe2df; --err: #9a2b1f;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1717; --surface: #162221; --ink: #e5efed; --ink-2: #93aaa7; --line: #263634;
      --accent: #3fb8b0; --accent-ink: #062120;
      --ok-bg: #173826; --ok: #8fd9a8; --warn-bg: #3a2a0c; --warn: #f2c26b;
      --muted-bg: #222d2c; --muted: #9aa8a7; --block-bg: #1d2740; --block: #a9bdf0;
      --err-bg: #3d1a16; --err: #f1a399;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 22px; margin: 0; }
  .sub { color: var(--ink-2); margin: 4px 0 20px; font-size: 13px; }
  h2 { font-size: 16px; margin: 28px 0 12px; display: flex; align-items: center; gap: 8px; }
  .count { font-size: 12px; background: var(--muted-bg); color: var(--muted); padding: 1px 8px; border-radius: 99px; }
  .flash { padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; }
  .flash.ok { background: var(--ok-bg); color: var(--ok); }
  .flash.err { background: var(--err-bg); color: var(--err); }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .card header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .id { color: var(--ink-2); font-size: 13px; font-variant-numeric: tabular-nums; }
  .pill { font-size: 12px; padding: 2px 9px; border-radius: 99px; font-weight: 600; }
  .pill.ok { background: var(--ok-bg); color: var(--ok); }
  .pill.warn { background: var(--warn-bg); color: var(--warn); }
  .pill.muted { background: var(--muted-bg); color: var(--muted); }
  .pill.block { background: var(--block-bg); color: var(--block); }
  .card h3 { font-size: 15px; margin: 10px 0 2px; }
  .dates { margin: 0; font-variant-numeric: tabular-nums; }
  .dates span { color: var(--ink-2); }
  .who { margin: 10px 0 0; display: flex; flex-direction: column; gap: 2px; }
  .who a { color: var(--accent); font-size: 13px; text-decoration: none; }
  .note { margin: 8px 0 0; font-size: 13px; color: var(--ink-2); }
  .pay { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: var(--ink-2); }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions form { flex: 1; }
  button { width: 100%; font: inherit; font-weight: 600; padding: 9px 12px; border-radius: 9px; cursor: pointer; }
  button.primary { background: var(--accent); color: var(--accent-ink); border: 1px solid var(--accent); }
  button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .empty { color: var(--ink-2); margin: 0; }
  details.block { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  details.block summary { cursor: pointer; font-weight: 600; }
  .form { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 12px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--ink-2); }
  .form input, .form select { font: inherit; padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
  .form .wide { grid-column: 1 / -1; }
</style>
</head>
<body>
<main>
  <h1>Painel de reservas</h1>
  <p class="sub">${esc(pixInfo)}</p>

  ${v.flash ? `<div class="flash ${v.flash.ok ? 'ok' : 'err'}" role="status">${esc(v.flash.text)}</div>` : ''}

  <details class="block">
    <summary>Bloquear datas (reserva por outro canal ou uso próprio)</summary>
    <form class="form" method="post" action="/admin/blocks">
      <label>Casa
        <select id="house" name="house" required>
          ${v.houses.map(h => `<option value="${esc(h.code)}">${esc(h.code)} · ${esc(h.name)}</option>`).join('')}
        </select>
      </label>
      <label>Entrada <input id="checkIn" type="date" name="checkIn" min="${esc(v.todayIso)}" required></label>
      <label>Saída <input id="checkOut" type="date" name="checkOut" min="${esc(v.todayIso)}" required></label>
      <label class="wide">Observação <input id="note" name="note" maxlength="200" placeholder="Ex.: reserva pelo Airbnb, Maria"></label>
      <button class="primary wide" type="submit">Bloquear</button>
    </form>
  </details>

  ${section('Aguardando pagamento', awaiting, 'Nenhuma pré-reserva em aberto.')}
  ${section('Confirmadas', confirmed, 'Nenhuma reserva confirmada pela frente.')}
  ${section('Histórico recente', history, 'Nada nos últimos 7 dias.')}
</main>
</body>
</html>`;
}
