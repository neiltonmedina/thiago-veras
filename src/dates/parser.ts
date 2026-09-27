/**
 * Parser de datas em português brasileiro pra reserva de casa.
 *
 * Retorna { checkIn, checkOut } como Date (à meia-noite local) ou null.
 * checkOut é EXCLUSIVE (dia da saída), padrão hoteleiro.
 */

const MESES: Record<string, number> = {
  janeiro: 0, jan: 0,
  fevereiro: 1, fev: 1,
  marco: 2, março: 2, mar: 2,
  abril: 3, abr: 3,
  maio: 4, mai: 4,
  junho: 5, jun: 5,
  julho: 6, jul: 6,
  agosto: 7, ago: 7,
  setembro: 8, set: 8,
  outubro: 9, out: 9,
  novembro: 10, nov: 10,
  dezembro: 11, dez: 11,
};

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, 'segunda-feira': 1, seg: 1,
  terca: 2, terça: 2, 'terca-feira': 2, 'terça-feira': 2, ter: 2,
  quarta: 3, 'quarta-feira': 3, qua: 3,
  quinta: 4, 'quinta-feira': 4, qui: 4,
  sexta: 5, 'sexta-feira': 5, sex: 5,
  sabado: 6, sábado: 6, sab: 6, sáb: 6,
};

export type DateRange = { checkIn: Date; checkOut: Date };

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function inferYear(day: number, month: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const candidate = new Date(currentYear, month, day);
  candidate.setHours(0, 0, 0, 0);
  // Se a data já passou esse ano, assume o ano seguinte
  if (candidate < today()) return currentYear + 1;
  return currentYear;
}

/**
 * Parser principal. Tenta várias estratégias em sequência.
 */
export function parseDateRange(input: string): DateRange | null {
  const s = normalize(input);
  if (!s) return null;

  return parseNumericRange(s)
      || parseTextualMonthRange(s)
      || parseWeekdayRange(s)
      || parseNextWeekend(s)
      || parseSingleDay(s);
}

/** "15/12 a 18/12" ou "15/12/2026 até 18/12/2026" ou "15/12-18/12" */
function parseNumericRange(s: string): DateRange | null {
  const re = /(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\s*(?:a|ate|-|até|—|–|e)\s*(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/;
  const m = s.match(re);
  if (!m) return null;

  const d1 = Number(m[1]);
  const mo1 = Number(m[2]) - 1;
  const y1 = m[3] ? normalizeYear(Number(m[3])) : inferYear(d1, mo1);
  const d2 = Number(m[4]);
  const mo2 = Number(m[5]) - 1;
  const y2 = m[6] ? normalizeYear(Number(m[6])) : inferYear(d2, mo2);

  const checkIn = mkDate(y1, mo1, d1);
  const checkOut = mkDate(y2, mo2, d2);
  return validate(checkIn, checkOut);
}

/** "15 a 18 de dezembro" ou "15 de dezembro a 18 de dezembro" */
function parseTextualMonthRange(s: string): DateRange | null {
  // "15 a 18 de dezembro [de 2026]"
  const shortRe = /(\d{1,2})\s*(?:a|ate|até|-|—|e)\s*(\d{1,2})\s*de\s*([a-zç]+)(?:\s+de\s+(\d{4}))?/i;
  let m = s.match(shortRe);
  if (m) {
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const mo = MESES[m[3]!];
    if (mo === undefined) return null;
    const y = m[4] ? Number(m[4]) : inferYear(d1, mo);
    return validate(mkDate(y, mo, d1), mkDate(y, mo, d2));
  }

  // "15 de dezembro a 18 de dezembro"
  const longRe = /(\d{1,2})\s*de\s*([a-zç]+)(?:\s+de\s+(\d{4}))?\s*(?:a|ate|até|-|—|e)\s*(\d{1,2})\s*de\s*([a-zç]+)(?:\s+de\s+(\d{4}))?/i;
  m = s.match(longRe);
  if (m) {
    const d1 = Number(m[1]);
    const mo1 = MESES[m[2]!];
    const d2 = Number(m[4]);
    const mo2 = MESES[m[5]!];
    if (mo1 === undefined || mo2 === undefined) return null;
    const y1 = m[3] ? Number(m[3]) : inferYear(d1, mo1);
    const y2 = m[6] ? Number(m[6]) : inferYear(d2, mo2);
    return validate(mkDate(y1, mo1, d1), mkDate(y2, mo2, d2));
  }

  return null;
}

/** "sexta a domingo", "sex a dom", "de sexta ate domingo" */
function parseWeekdayRange(s: string): DateRange | null {
  const re = /(?:de\s+)?([a-zç]+(?:-feira)?)\s+(?:a|ate|até|-|—)\s+([a-zç]+(?:-feira)?)/i;
  const m = s.match(re);
  if (!m) return null;

  const w1 = DIAS_SEMANA[m[1]!];
  const w2 = DIAS_SEMANA[m[2]!];
  if (w1 === undefined || w2 === undefined) return null;

  const t = today();
  const cur = t.getDay();
  const daysUntilStart = (w1 - cur + 7) % 7 || 7;   // próxima ocorrência (nunca hoje mesmo)
  const start = addDays(t, daysUntilStart);
  const daysBetween = (w2 - w1 + 7) % 7 || 7;
  const end = addDays(start, daysBetween);
  return validate(start, end);
}

/** "proximo fim de semana", "fim de semana que vem", "fds" */
function parseNextWeekend(s: string): DateRange | null {
  if (!/(pr[oó]ximo\s+fim\s+de\s+semana|fim\s+de\s+semana\s+que\s+vem|proximo\s+fds|fds\s+que\s+vem)/.test(s)) {
    return null;
  }
  const t = today();
  const cur = t.getDay();
  const daysUntilFri = (5 - cur + 7) % 7 || 7;
  const start = addDays(t, daysUntilFri);   // sexta
  const end = addDays(start, 2);            // domingo (checkout)
  return validate(start, end);
}

/** "hoje", "amanha", "depois de amanha" — só 1 diária */
function parseSingleDay(s: string): DateRange | null {
  if (/^hoje$/.test(s)) {
    const t = today();
    return validate(t, addDays(t, 1));
  }
  if (/^amanha$/.test(s)) {
    const t = addDays(today(), 1);
    return validate(t, addDays(t, 1));
  }
  if (/^depois de amanha$/.test(s)) {
    const t = addDays(today(), 2);
    return validate(t, addDays(t, 1));
  }
  return null;
}

function normalizeYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function mkDate(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function validate(checkIn: Date, checkOut: Date): DateRange | null {
  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) return null;
  if (checkOut <= checkIn) return null;
  const t = today();
  if (checkIn < t) return null;                       // não permite passado
  const maxOut = addDays(t, 365);
  if (checkOut > maxOut) return null;                 // máx 1 ano à frente
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
  if (nights > 60) return null;                       // máx 60 noites
  return { checkIn, checkOut };
}

/** DD/MM formato pt-BR */
export function formatBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/** YYYY-MM-DD para armazenar no SQLite */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function fromIsoDate(s: string): Date {
  const [y, mo, da] = s.split('-').map(Number);
  return mkDate(y!, mo! - 1, da!);
}

export function nightsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
