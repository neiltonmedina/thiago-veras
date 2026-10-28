/**
 * Painel do Thiago: tela de login, aplicativo (HTML/CSS/JS em ./ui) e a API JSON
 * que ele usa. Tudo sob /admin.
 *
 *  - Login por formulário com cookie assinado (30 dias); a autenticação Basic
 *    continua aceita para ferramentas como curl.
 *  - Os arquivos de ./ui (CSS, JS, ícones, manifest) são públicos: não têm dado
 *    nenhum. Só o HTML do app e a API exigem login.
 *  - Ações (POST) só passam vindas da própria página: exigem o cabeçalho
 *    X-Painel (um site de fora não consegue enviá-lo sem pré-verificação CORS,
 *    que aqui nunca é liberada) e conferem a origem.
 */
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { getCatalog } from '../houses/catalog.js';
import { toIsoDate } from '../dates/parser.js';
import * as store from '../reservations/store.js';
import type { Reservation } from '../reservations/store.js';
import { confirmManually, cancelReservation, blockDates, type ActionResult } from '../reservations/lifecycle.js';
import {
  SESSION_COOKIE, SESSION_DAYS, checkCredentials, createSessionToken, verifySessionToken, readCookie,
} from './session.js';
import {
  checkPassword, setPassword, rotateEpoch, validarSenhaNova, criarTokenReset, tokenResetValido, consumirTokenReset, RESET_VALIDADE_MIN,
} from './credentials.js';
import { enviarEmail, emailRedefinir } from './mailer.js';

export const adminRouter = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, 'ui');
const VERSION = Date.now().toString(36); // muda a cada reinício: força o navegador a baixar o app novo

function page(name: string): string {
  return readFileSync(join(UI_DIR, name), 'utf-8').replaceAll('__V__', VERSION);
}
const ESQUECI_ATIVO = config.mail.enabled;
const LOGIN_HTML = page('login.html').replace('__ESQUECI__', ESQUECI_ATIVO
  ? '<a class="esqueci" href="/admin/esqueci">Esqueci minha senha</a>'
  : '<p class="dica-login">Esqueceu a senha? Peça ao responsável pelo sistema para gerar outra.</p>');
const APP_HTML = page('app.html');
const ESQUECI_HTML = page('esqueci.html');
const REDEFINIR_HTML = page('redefinir.html');

// ---------- autenticação ----------
function basicOk(req: Request): boolean {
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const sep = decoded.indexOf(':');
  return sep > 0 && checkCredentials(decoded.slice(0, sep), decoded.slice(sep + 1));
}

function isAuthed(req: Request): boolean {
  return verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE)) || basicOk(req);
}

function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (isAuthed(req)) { next(); return; }
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ ok: false, message: 'Sessão expirada. Entre de novo.' });
    return;
  }
  res.redirect(302, '/admin/login');
}

function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  const source = req.headers.origin ?? req.headers.referer;
  try {
    if (source && new URL(source).host === req.headers.host && req.headers['x-painel'] === '1') { next(); return; }
  } catch {
    // URL malformada cai no 403 abaixo
  }
  res.status(403).json({ ok: false, message: 'Requisição bloqueada.' });
}

// ---------- limites de tentativas ----------
const falhas = new Map<string, number[]>();
function bloqueado(chave: string, max = 8, janelaMs = 15 * 60_000): boolean {
  const agora = Date.now();
  const lista = (falhas.get(chave) ?? []).filter(t => agora - t < janelaMs);
  falhas.set(chave, lista);
  return lista.length >= max;
}
function registrarFalha(chave: string): void {
  falhas.set(chave, [...(falhas.get(chave) ?? []), Date.now()]);
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, l] of falhas) {
    const f = l.filter(t => agora - t < 60 * 60_000);
    if (f.length) falhas.set(k, f); else falhas.delete(k);
  }
}, 10 * 60_000).unref();

function cookieDeSessao(req: Request): string {
  const seguro = req.secure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken())}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${seguro}`;
}

/** Só aceita pedidos feitos pela própria página (mesmo endereço + cabeçalho X-Painel). */
function origemPropria(req: Request): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  try {
    return !!source && new URL(source).host === req.headers.host && req.headers['x-painel'] === '1';
  } catch {
    return false;
  }
}

// ---------- arquivos públicos do app ----------
adminRouter.use('/ui', express.static(UI_DIR, { maxAge: '1h', index: false }));

adminRouter.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json({
    name: 'Painel Thiago Veras',
    short_name: 'Painel',
    start_url: '/admin/',
    scope: '/admin/',
    display: 'standalone',
    background_color: '#2b2b2b',
    theme_color: '#2b2b2b',
    icons: [
      { src: `/admin/ui/icon-192.png?v=${VERSION}`, sizes: '192x192', type: 'image/png' },
      { src: `/admin/ui/icon-512.png?v=${VERSION}`, sizes: '512x512', type: 'image/png' },
    ],
  });
});

// ---------- login ----------
adminRouter.get('/login', (req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado. Defina ADMIN_PASSWORD no .env.'); return; }
  if (isAuthed(req)) { res.redirect(302, '/admin/'); return; }
  res.set('Cache-Control', 'no-store').type('html').send(LOGIN_HTML);
});

adminRouter.post('/login', express.json({ limit: '2kb' }), (req, res) => {
  if (!config.admin) { res.status(404).json({ ok: false, message: 'Painel desligado.' }); return; }
  if (!origemPropria(req)) {
    res.status(403).json({ ok: false, message: 'Requisição bloqueada.' });
    return;
  }
  if (bloqueado(`login:${req.ip}`)) {
    res.status(429).json({ ok: false, message: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    return;
  }
  const { usuario, senha } = (req.body ?? {}) as { usuario?: unknown; senha?: unknown };
  if (typeof usuario !== 'string' || typeof senha !== 'string' || !checkCredentials(usuario.trim(), senha)) {
    registrarFalha(`login:${req.ip}`);
    res.status(401).json({ ok: false, message: 'Usuário ou senha incorretos.' });
    return;
  }
  falhas.delete(`login:${req.ip}`);
  res.set('Set-Cookie', cookieDeSessao(req));
  res.json({ ok: true });
});

adminRouter.post('/logout', sameOrigin, (_req, res) => {
  res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// ---------- esqueci minha senha (por e-mail) ----------
const RESPOSTA_ESQUECI = 'Se o e-mail estiver cadastrado, enviamos o link para criar a nova senha. Confira também a caixa de spam.';

adminRouter.get('/esqueci', (req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado.'); return; }
  if (!ESQUECI_ATIVO) { res.redirect(302, '/admin/login'); return; }
  res.set('Cache-Control', 'no-store').type('html').send(ESQUECI_HTML);
});

adminRouter.post('/esqueci', express.json({ limit: '2kb' }), (req, res) => {
  if (!config.admin || !ESQUECI_ATIVO) { res.status(404).json({ ok: false, message: 'Recuperação por e-mail não está ligada.' }); return; }
  if (!origemPropria(req)) { res.status(403).json({ ok: false, message: 'Requisição bloqueada.' }); return; }
  // limites por internet e no total, para ninguém usar isto para encher a caixa de e-mail do Thiago
  if (bloqueado(`esqueci:${req.ip}`, 3, 60 * 60_000) || bloqueado('esqueci:total', 8, 60 * 60_000)) {
    res.status(429).json({ ok: false, message: 'Muitos pedidos. Espere um pouco e tente de novo.' });
    return;
  }
  registrarFalha(`esqueci:${req.ip}`); registrarFalha('esqueci:total');
  const email = typeof (req.body as { email?: unknown })?.email === 'string' ? (req.body as { email: string }).email.trim().toLowerCase() : '';
  // a resposta é sempre a mesma, exista o e-mail ou não; o envio acontece depois de responder
  res.json({ ok: true, message: RESPOSTA_ESQUECI });
  if (email && config.admin.email && email === config.admin.email) {
    const token = criarTokenReset();
    const link = `${config.publicUrl}/admin/redefinir#${token}`;
    enviarEmail(emailRedefinir(link, RESET_VALIDADE_MIN))
      .then(() => console.log('[painel] link de nova senha enviado'))
      .catch(err => console.error('[painel] falha ao enviar o e-mail de nova senha:', err instanceof Error ? err.message : err));
  }
});

adminRouter.get('/redefinir', (_req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado.'); return; }
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').type('html').send(REDEFINIR_HTML);
});

adminRouter.post('/redefinir/verificar', express.json({ limit: '2kb' }), (req, res) => {
  if (!config.admin || !origemPropria(req)) { res.status(403).json({ ok: false }); return; }
  if (bloqueado(`redef:${req.ip}`, 10, 15 * 60_000)) { res.status(429).json({ ok: false, message: 'Muitas tentativas. Espere alguns minutos.' }); return; }
  const token = typeof (req.body as { token?: unknown })?.token === 'string' ? (req.body as { token: string }).token : '';
  const ok = tokenResetValido(token);
  if (!ok) registrarFalha(`redef:${req.ip}`);
  res.json({ ok, message: ok ? '' : 'Este link não é mais válido. Peça um novo em "Esqueci minha senha".' });
});

adminRouter.post('/redefinir', express.json({ limit: '2kb' }), (req, res) => {
  if (!config.admin || !origemPropria(req)) { res.status(403).json({ ok: false, message: 'Requisição bloqueada.' }); return; }
  if (bloqueado(`redef:${req.ip}`, 10, 15 * 60_000)) { res.status(429).json({ ok: false, message: 'Muitas tentativas. Espere alguns minutos.' }); return; }
  const { token, nova } = (req.body ?? {}) as { token?: unknown; nova?: unknown };
  if (typeof token !== 'string' || typeof nova !== 'string') { res.status(400).json({ ok: false, message: 'Pedido inválido.' }); return; }
  const problema = validarSenhaNova(nova);
  if (problema) { res.status(422).json({ ok: false, message: problema }); return; }   // não gasta o link
  if (!consumirTokenReset(token)) {
    registrarFalha(`redef:${req.ip}`);
    res.status(410).json({ ok: false, message: 'Este link não é mais válido. Peça um novo em "Esqueci minha senha".' });
    return;
  }
  setPassword(nova);
  console.log('[painel] senha redefinida pelo link do e-mail');
  res.json({ ok: true, message: 'Senha criada. Entre com a senha nova.' });
});

// ---------- tudo daqui para baixo exige login ----------
adminRouter.use(requireLogin);

adminRouter.get('/', (_req, res) => {
  if (!config.admin) { res.status(404).send('Painel desligado. Defina ADMIN_PASSWORD no .env.'); return; }
  res.set('Cache-Control', 'no-store').type('html').send(APP_HTML);
});

// Estado completo da tela: casas e reservas. O app consulta isto a cada poucos segundos.
adminRouter.get('/api/estado', async (_req, res) => {
  const catalog = await getCatalog();
  const names = new Map(catalog.map(h => [h.code, h.name]));
  const hoje = toIsoDate(new Date());
  const clientes = new Map<number, store.Client | null>();
  const nomeDe = (r: Reservation): string | null => {
    if (r.clientId == null) return r.guestName;
    if (!clientes.has(r.clientId)) clientes.set(r.clientId, store.getClientById(r.clientId));
    return clientes.get(r.clientId)?.name ?? r.guestName;
  };
  res.set('Cache-Control', 'no-store').json({
    agora: Date.now(),
    hoje,
    holdMinutos: config.holdMinutes,
    pixAutomatico: !!config.pix,
    casas: catalog.map(h => ({ codigo: h.code, nome: h.name })),
    reservas: store.listForAdmin(hoje).map(r => ({
      id: r.id,
      casa: r.houseCode,
      casaNome: names.get(r.houseCode) ?? r.houseCode,
      entrada: r.checkIn,
      saida: r.checkOut,
      diarias: r.nights,
      status: r.status,
      origem: r.source,
      nome: nomeDe(r),
      pessoas: r.guests,
      whatsapp: r.clientPhone || null,
      total: r.totalCents,
      sinal: r.depositCents,
      pago: !!r.paidAt,
      obs: r.note,
      expiraEm: r.expiresAt,
      criadoEm: r.createdAt,
    })),
  });
});

function responder(res: Response, r: ActionResult, extra: Record<string, unknown> = {}): void {
  res.status(r.ok ? 200 : 409).json({ ok: r.ok, message: r.message, ...extra });
}

adminRouter.post('/api/reservas/:id/confirmar', sameOrigin, async (req, res) => {
  responder(res, await confirmManually(Number(req.params.id)));
});

adminRouter.post('/api/reservas/:id/cancelar', sameOrigin, async (req, res) => {
  responder(res, await cancelReservation(Number(req.params.id)));
});

adminRouter.post('/api/reservas/:id/mais-tempo', sameOrigin, express.json({ limit: '1kb' }), (req, res) => {
  const id = Number(req.params.id);
  const pedido = Number((req.body as { minutos?: unknown } | undefined)?.minutos);
  const minutos = Number.isFinite(pedido) ? Math.min(Math.max(Math.round(pedido), 5), 24 * 60) : 60;
  const r = store.extendHold(id, minutos);
  if (r.ok) {
    responder(res, { ok: true, message: `Mais ${minutos >= 60 ? `${Math.round(minutos / 60)}h` : `${minutos} min`} para o pedido #${id}.` }, { expiraEm: r.reservation.expiresAt });
    return;
  }
  const msg = r.reason === 'overlap' ? `Não dá: as datas do pedido #${id} já foram ocupadas por outra reserva.`
    : r.reason === 'not_found' ? `Pedido #${id} não encontrado.`
      : `O pedido #${id} não está aguardando pagamento.`;
  responder(res, { ok: false, message: msg });
});

adminRouter.post('/api/bloqueios', sameOrigin, express.json({ limit: '2kb' }), async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  responder(res, await blockDates({
    houseCode: typeof b.casa === 'string' ? b.casa : '',
    checkInIso: typeof b.entrada === 'string' ? b.entrada : '',
    checkOutIso: typeof b.saida === 'string' ? b.saida : '',
    note: typeof b.obs === 'string' ? b.obs : '',
  }));
});

adminRouter.get('/api/conta', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ usuario: config.admin?.user, emailRecuperacao: ESQUECI_ATIVO ? mascarar(config.admin?.email ?? '') : null });
});

function mascarar(email: string): string {
  const [nome = '', dominio = ''] = email.split('@');
  return `${nome.slice(0, 2)}${'•'.repeat(Math.max(2, nome.length - 2))}@${dominio}`;
}

adminRouter.post('/api/senha', sameOrigin, express.json({ limit: '2kb' }), (req, res) => {
  const chave = `senha:${req.ip}`;
  if (bloqueado(chave, 6, 15 * 60_000)) { res.status(429).json({ ok: false, message: 'Muitas tentativas. Espere alguns minutos.' }); return; }
  const { atual, nova } = (req.body ?? {}) as { atual?: unknown; nova?: unknown };
  if (typeof atual !== 'string' || typeof nova !== 'string') { res.status(400).json({ ok: false, message: 'Pedido inválido.' }); return; }
  if (!checkPassword(atual)) {
    registrarFalha(chave);
    res.status(403).json({ ok: false, message: 'A senha atual está incorreta.' });
    return;
  }
  const problema = validarSenhaNova(nova);
  if (problema) { res.status(422).json({ ok: false, message: problema }); return; }
  if (checkPassword(nova)) { res.status(422).json({ ok: false, message: 'Escolha uma senha diferente da atual.' }); return; }
  setPassword(nova);
  falhas.delete(chave);
  console.log('[painel] senha trocada pelo painel');
  res.set('Set-Cookie', cookieDeSessao(req)).json({ ok: true, message: 'Senha trocada. Os outros aparelhos precisam entrar de novo.' });
});

adminRouter.post('/api/sair-todos', sameOrigin, (req, res) => {
  rotateEpoch();
  console.log('[painel] todas as sessões encerradas');
  res.set('Set-Cookie', cookieDeSessao(req)).json({ ok: true, message: 'Todos os outros aparelhos foram desconectados.' });
});

adminRouter.use('/api', (_req, res) => { res.status(404).json({ ok: false, message: 'Não encontrado.' }); });

