/**
 * Teste da API do site contra um servidor de verdade (banco em memória).
 * Rodar: npm run test:site
 */
process.env.SIMULATE = '1';
process.env.CATALOG_PATH = new URL('../src/houses/data.json', import.meta.url).pathname; // as casas reais
process.env.HOLD_MINUTES = '120';
process.env.WEB_ORIGINS = 'https://site-autorizado.example';

import type { AddressInfo } from 'node:net';

// Imports dinâmicos: o ambiente de teste precisa estar definido antes de carregar a configuração
const { default: express } = await import('express');
const { siteApi } = await import('../src/site/api.js');
const { adminRouter } = await import('../src/admin/routes.js');
const { config } = await import('../src/config.js');
const store = await import('../src/reservations/store.js');
const { expireAndNotify } = await import('../src/reservations/lifecycle.js');

const app = express();
app.set('trust proxy', 'loopback');
app.use('/api', siteApi);
app.use('/admin', adminRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const ORIGIN = 'https://site-autorizado.example';
const auth = 'Basic ' + Buffer.from(`${config.admin!.user}:${config.admin!.password}`).toString('base64');

let failed = 0;
function check(nome: string, ok: boolean, detalhe = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : `  ← ${detalhe}`}`);
  if (!ok) failed++;
}
const iso = (offsetDays: number) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
async function post(path: string, body: unknown, headers: Record<string, string> = {}, ip?: string) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(ip ? { 'X-Forwarded-For': ip } : {}), ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as any, headers: res.headers };
}
async function get(path: string) {
  const res = await fetch(base + path, { headers: { Origin: ORIGIN } });
  return { status: res.status, json: await res.json().catch(() => ({})) as any, headers: res.headers };
}
const painel = { Authorization: auth, Origin: base, Host: new URL(base).host, 'X-Painel': '1' };
async function admin(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = painel) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as any, headers: res.headers, res };
}

// 1. calendário vazio
let r = await get('/api/disponibilidade');
check('calendário começa vazio para as 4 casas', r.status === 200 && Object.keys(r.json.casas).length === 4
  && Object.values<any>(r.json.casas).every(l => l.length === 0), JSON.stringify(r.json));
check('CORS libera o site autorizado', r.headers.get('access-control-allow-origin') === ORIGIN);
check('API informa o prazo de segurança das datas', r.json.holdMinutos === 120);

// 2. pré-reserva válida
r = await post('/api/reservar', { casa: 'C03', entrada: iso(30), saida: iso(33), pessoas: 6, nome: 'Ana Souza', whatsapp: '(86) 99911-2233' }, {}, '10.0.0.1');
check('pré-reserva criada (201)', r.status === 201 && r.json.ok === true && r.json.id > 0, JSON.stringify(r.json));
const idAna = r.json.id;
const rowAna = store.getById(idAna)!;
check('datas seguras pelo prazo configurado (120 min)', Math.abs((rowAna.expiresAt! - rowAna.createdAt) - 120 * 60_000) < 2000);
check('reserva guarda nome, pessoas e telefone com 55', rowAna.guestName === 'Ana Souza' && rowAna.guests === 6 && rowAna.clientPhone === '5586999112233' && rowAna.source === 'site', JSON.stringify(rowAna));

// 3. calendário passa a mostrar o período, sem dados do cliente
r = await get('/api/disponibilidade?casa=C03');
check('calendário mostra o período ocupado', JSON.stringify(r.json.casas.C03) === JSON.stringify([[iso(30), iso(33)]]), JSON.stringify(r.json));
check('calendário não expõe nome nem telefone', !JSON.stringify(r.json).match(/Ana|5586/));

// 4. mesmas datas: conflito
r = await post('/api/reservar', { casa: 'C03', entrada: iso(31), saida: iso(34), nome: 'Bruno' }, {}, '10.0.0.2');
check('período que cruza é recusado (409)', r.status === 409 && r.json.erro === 'ocupado', JSON.stringify(r));
r = await post('/api/reservar', { casa: 'C03', entrada: iso(33), saida: iso(35), nome: 'Bruno' }, {}, '10.0.0.2');
check('começar no dia da saída da outra reserva é permitido', r.status === 201, JSON.stringify(r));
r = await post('/api/reservar', { casa: 'C04', entrada: iso(30), saida: iso(33), nome: 'Carla' }, {}, '10.0.0.3');
check('outra casa nas mesmas datas é permitido', r.status === 201, JSON.stringify(r));

// 5. corrida: dois pedidos ao mesmo tempo para o mesmo período
const [a, b] = await Promise.all([
  post('/api/reservar', { casa: 'C01', entrada: iso(50), saida: iso(53), nome: 'Dani' }, {}, '10.0.1.1'),
  post('/api/reservar', { casa: 'C01', entrada: iso(50), saida: iso(53), nome: 'Edu' }, {}, '10.0.1.2'),
]);
check('dois pedidos simultâneos: só um passa', [a.status, b.status].sort().join() === '201,409', `${a.status},${b.status}`);

// 6. validações
const casos: [string, any, number][] = [
  ['casa inexistente', { casa: 'X9', entrada: iso(10), saida: iso(12) }, 400],
  ['data impossível', { casa: 'C01', entrada: '2026-02-31', saida: '2026-03-02' }, 400],
  ['saída antes da entrada', { casa: 'C01', entrada: iso(20), saida: iso(18) }, 400],
  ['entrada no passado', { casa: 'C01', entrada: iso(-2), saida: iso(2) }, 400],
  ['período longo demais', { casa: 'C01', entrada: iso(100), saida: iso(200) }, 400],
  ['texto no lugar da data', { casa: 'C01', entrada: 'amanhã', saida: 'depois' }, 400],
];
for (const [nome, corpo, esperado] of casos) {
  r = await post('/api/reservar', corpo, {}, '10.0.2.1');
  check(`validação: ${nome}`, r.status === esperado, JSON.stringify(r));
}
r = await post('/api/reservar', { casa: 'C02', entrada: iso(70), saida: iso(72), nome: '<script>alert(1)</script>  Zé   ', whatsapp: 'abc' }, {}, '10.0.2.2');
const rowZe = store.getById(r.json.id)!;
check('nome é limpo de marcações e telefone inválido é ignorado', rowZe.guestName === 'scriptalert(1)/script Zé' && rowZe.clientPhone === '', JSON.stringify(rowZe.guestName));

// 7. um telefone só segura um período por vez
r = await post('/api/reservar', { casa: 'C02', entrada: iso(80), saida: iso(82), whatsapp: '86999112233' }, {}, '10.0.3.1');
check('mesmo WhatsApp com reserva em aberto é barrado (429)', r.status === 429 && r.json.erro === 'ja_tem_reserva_em_aberto', JSON.stringify(r));

// 8. origem não autorizada
r = await post('/api/reservar', { casa: 'C02', entrada: iso(90), saida: iso(92) }, { Origin: 'https://site-malicioso.example' }, '10.0.4.1');
check('origem não autorizada não cria reserva (403)', r.status === 403, JSON.stringify(r));
const pre = await fetch(base + '/api/reservar', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
check('pré-verificação do navegador (OPTIONS) liberada', pre.status === 204 && pre.headers.get('access-control-allow-methods')!.includes('POST'));

// 9. limite por IP
let barrado = 0;
for (let i = 0; i < 9; i++) {
  const x = await post('/api/reservar', { casa: 'C01', entrada: iso(200 + i * 3), saida: iso(202 + i * 3), nome: `T${i}` }, {}, '10.0.9.9');
  if (x.status === 429) barrado++;
}
check('muitas pré-reservas do mesmo IP são barradas (429)', barrado >= 3, `barrou ${barrado}`);

// 10. painel novo: login, estado, confirmar, cancelar, mais tempo
let st = await admin('/admin/api/estado');
const pedido = st.json.reservas.find((x: any) => x.id === idAna);
check('painel lista o pedido do site com nome, pessoas e WhatsApp', st.status === 200 && pedido?.nome === 'Ana Souza' && pedido.pessoas === 6 && pedido.whatsapp === '5586999112233' && pedido.origem === 'site', JSON.stringify(pedido));
check('painel informa o prazo e as casas', st.json.holdMinutos === 120 && st.json.casas.length === 4 && typeof st.json.agora === 'number');

const semLogin = await fetch(base + '/admin/api/estado');
check('API do painel sem login responde 401', semLogin.status === 401);
const telaSemLogin = await fetch(base + '/admin/', { redirect: 'manual' });
check('tela do painel sem login leva para /admin/login', telaSemLogin.status === 302 && telaSemLogin.headers.get('location') === '/admin/login');
const login = await fetch(base + '/admin/login');
check('página de login abre sem senha', login.status === 200 && (await login.text()).includes('Painel de reservas'));
const css = await fetch(base + '/admin/ui/app.css'); const man = await fetch(base + '/admin/manifest.webmanifest');
check('estilo, app e manifest são públicos e existem', css.status === 200 && (await fetch(base + '/admin/ui/app.js')).status === 200 && man.status === 200 && (await man.json()).short_name === 'Painel');

const entrar = (usuario: string, senha: string, extra: Record<string, string> = {}) => fetch(base + '/admin/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Painel': '1', 'X-Forwarded-For': '10.7.7.7', ...extra }, body: JSON.stringify({ usuario, senha }),
});
let lg = await entrar('thiago', 'errada');
check('senha errada é recusada (401)', lg.status === 401);
lg = await entrar('thiago', config.admin!.password, { Origin: 'https://site-de-fora.example' });
check('login vindo de outro site é bloqueado (403)', lg.status === 403);
lg = await entrar('thiago', config.admin!.password);
const cookie = (lg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
check('senha certa cria sessão (cookie HttpOnly e SameSite)', lg.status === 200 && /painel_sessao=/.test(cookie) && /HttpOnly/i.test(lg.headers.get('set-cookie') ?? '') && /SameSite=Strict/i.test(lg.headers.get('set-cookie') ?? ''));
const comCookie = await fetch(base + '/admin/api/estado', { headers: { Cookie: cookie } });
check('a sessão por cookie abre a API do painel', comCookie.status === 200);
const adulterado = await fetch(base + '/admin/api/estado', { headers: { Cookie: cookie.slice(0, -3) + 'xyz' } });
check('cookie adulterado é recusado', adulterado.status === 401);
const telaApp = await fetch(base + '/admin/', { headers: { Cookie: cookie } });
check('com sessão, a tela do painel abre', telaApp.status === 200 && (await telaApp.text()).includes('id="conteudo"'));

const acaoSemCabecalho = await admin(`/admin/api/reservas/${idAna}/confirmar`, 'POST', undefined, { Authorization: auth, Origin: base });
check('ação sem o cabeçalho do painel é bloqueada (403)', acaoSemCabecalho.status === 403 && store.getById(idAna)!.status === 'pending');
const acaoDeFora = await admin(`/admin/api/reservas/${idAna}/confirmar`, 'POST', undefined, { ...painel, Origin: 'https://site-de-fora.example' });
check('ação vinda de outro site é bloqueada (403)', acaoDeFora.status === 403 && store.getById(idAna)!.status === 'pending');

const antes = store.getById(idAna)!.expiresAt!;
let mt = await admin(`/admin/api/reservas/${idAna}/mais-tempo`, 'POST', { minutos: 60 });
check('+1 hora estende o prazo das datas', mt.status === 200 && Math.abs(store.getById(idAna)!.expiresAt! - (antes + 3_600_000)) < 2000, JSON.stringify(mt.json));

let conf = await admin(`/admin/api/reservas/${idAna}/confirmar`, 'POST');
check('Thiago confirma no painel', conf.status === 200 && conf.json.ok && store.getById(idAna)!.status === 'confirmed', JSON.stringify(conf.json));
r = await get('/api/disponibilidade?casa=C03');
check('depois de confirmada, as datas continuam ocupadas', r.json.casas.C03.some((p: string[]) => p[0] === iso(30)));
mt = await admin(`/admin/api/reservas/${idAna}/mais-tempo`, 'POST', { minutos: 60 });
check('reserva já confirmada não aceita mais tempo', mt.status === 409);
let canc = await admin(`/admin/api/reservas/${idAna}/cancelar`, 'POST');
check('Thiago cancela no painel', canc.status === 200 && store.getById(idAna)!.status === 'cancelled');
r = await get('/api/disponibilidade?casa=C03');
check('depois de cancelada, as datas voltam a ficar livres', !r.json.casas.C03.some((p: string[]) => p[0] === iso(30)));
r = await post('/api/reservar', { casa: 'C03', entrada: iso(30), saida: iso(33), nome: 'Fábio' }, {}, '10.0.5.1');
check('e outro cliente consegue reservar o mesmo período', r.status === 201, JSON.stringify(r));
const idFabio = r.json.id;
canc = await admin(`/admin/api/reservas/9999/cancelar`, 'POST');
check('cancelar pedido inexistente responde com erro claro', canc.status === 409 && /não encontrada/.test(canc.json.message), JSON.stringify(canc.json));

// reativar um pedido expirado
const realNow0 = Date.now;
Date.now = () => realNow0() + 121 * 60_000; await expireAndNotify(); Date.now = realNow0;
check('pedido do Fábio expirou depois do prazo', store.getById(idFabio)!.status === 'expired');
const reativa = await admin(`/admin/api/reservas/${idFabio}/mais-tempo`, 'POST', { minutos: 120 });
check('Thiago reativa o pedido expirado se as datas continuam livres', reativa.status === 200 && store.getById(idFabio)!.status === 'pending', JSON.stringify(reativa.json));
await admin(`/admin/api/reservas/${idFabio}/cancelar`, 'POST');

// bloqueio feito no painel
let bl = await admin('/admin/api/bloqueios', 'POST', { casa: 'C04', entrada: iso(120), saida: iso(123), obs: 'Uso próprio' });
check('Thiago bloqueia datas pelo painel', bl.status === 200 && bl.json.ok, JSON.stringify(bl.json));
r = await get('/api/disponibilidade?casa=C04');
check('bloqueio aparece no calendário do site', r.json.casas.C04.some((p: string[]) => p[0] === iso(120) && p[1] === iso(123)));
bl = await admin('/admin/api/bloqueios', 'POST', { casa: 'C04', entrada: iso(121), saida: iso(124), obs: 'cruza' });
check('bloqueio que cruza com outro é recusado', bl.status === 409, JSON.stringify(bl.json));
bl = await admin('/admin/api/bloqueios', 'POST', { casa: 'C99', entrada: iso(130), saida: iso(131) });
check('bloqueio em casa inexistente é recusado', bl.status === 409);

// 11. expiração: pedidos não pagos expiram sozinhos e as datas voltam a ficar livres
const realNow = Date.now;
Date.now = () => realNow() + 121 * 60_000;
await expireAndNotify();
Date.now = realNow;
r = await get('/api/disponibilidade?casa=C01');
const expiradosC01 = store.listForAdmin('2000-01-01').filter(x => x.houseCode === 'C01' && x.status === 'expired').length;
check('pré-reservas não pagas expiram e as datas se liberam', expiradosC01 > 0 && r.json.casas.C01.length === 0, `expirados=${expiradosC01} ${JSON.stringify(r.json.casas.C01)}`);

server.close();
console.log(failed ? `\n❌ ${failed} verificação(ões) falharam.` : '\n✅ Todas as verificações passaram.');
process.exit(failed ? 1 : 0);
