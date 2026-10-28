/**
 * Credenciais do painel.
 *
 * A senha de partida vem do .env (ADMIN_PASSWORD). Depois que o Thiago troca a senha
 * pelo painel (ou por "esqueci minha senha"), o que vale é um hash scrypt guardado no
 * banco; a senha do .env passa a ser só o plano B (resetar-senha.sh apaga o hash).
 * Cada troca ou "sair de todos os aparelhos" muda a "época", que entra na assinatura
 * das sessões e invalida todas as que estavam abertas.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';

const get = db.prepare(`SELECT value FROM admin_settings WHERE key = ?`);
const put = db.prepare(`INSERT INTO admin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const del = db.prepare(`DELETE FROM admin_settings WHERE key = ?`);

function setting(key: string): string | null {
  const row = get.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------- hash da senha ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(pass: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pass, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyHash(pass: string, stored: string): boolean {
  const [kind, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(pass, Buffer.from(saltB64, 'base64'), expected.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function hasCustomPassword(): boolean {
  return setting('password_hash') !== null;
}

/** Confere usuário e senha (a do banco, se já foi trocada; senão a do .env). */
export function checkCredentials(user: string, pass: string): boolean {
  if (!config.admin) return false;
  const okUser = safeEqual(user, config.admin.user);
  const stored = setting('password_hash');
  const okPass = stored ? verifyHash(pass, stored) : safeEqual(pass, config.admin.password);
  return okUser && okPass;
}

export function checkPassword(pass: string): boolean {
  return config.admin ? checkCredentials(config.admin.user, pass) : false;
}

export function setPassword(pass: string): void {
  put.run('password_hash', hashPassword(pass));
  rotateEpoch();
}

/** Muda a época: derruba todas as sessões abertas. */
export function rotateEpoch(): void {
  put.run('session_epoch', randomBytes(12).toString('base64url'));
}

/** Material que assina as sessões: muda com a senha e com a época. */
export function sessionSecret(): Buffer {
  const base = setting('password_hash') ?? `env:${config.admin?.password ?? ''}`;
  return createHash('sha256').update(`painel|${config.admin?.user ?? ''}|${base}|${setting('session_epoch') ?? '0'}`).digest();
}

/** Volta para a senha do .env (usado pelo script de emergência e pelos testes). */
export function clearCustomPassword(): void {
  del.run('password_hash');
  rotateEpoch();
}

// ---------- regras de senha ----------
const COMUNS = ['12345678', '123456789', '1234567890', 'senha123', 'senha1234', 'password', 'qwertyuiop', 'abcdefgh', '11111111', '00000000', 'admin123', 'admin1234', 'mudar123'];

export function validarSenhaNova(pass: string): string | null {
  if (pass.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (pass.length > 100) return 'A senha pode ter no máximo 100 caracteres.';
  if (/\s/.test(pass)) return 'A senha não pode ter espaços.';
  if (/^\d+$/.test(pass)) return 'Misture letras na senha, não use só números.';
  if (/^(.)\1+$/.test(pass)) return 'Escolha uma senha menos repetitiva.';
  const min = pass.toLowerCase();
  if (COMUNS.some(c => min.includes(c))) return 'Essa senha é fácil demais de adivinhar. Escolha outra.';
  if (/(thiago|veras|tvs|empreendimentos|muniz)/.test(min)) return 'Não use o nome da empresa ou do Thiago na senha.';
  if (config.admin && min === config.admin.password.toLowerCase()) return 'Escolha uma senha diferente da atual.';
  return null;
}

// ---------- links de redefinição ----------
const RESET_MINUTOS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Cria um link de uso único e invalida os anteriores. Retorna o código (só vai por e-mail). */
export function criarTokenReset(now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare(`UPDATE reset_tokens SET used_at = ? WHERE used_at IS NULL`).run(now);
  db.prepare(`INSERT INTO reset_tokens (token_hash, expires_at, created_at) VALUES (?, ?, ?)`).run(sha(token), now + RESET_MINUTOS * 60_000, now);
  return token;
}

export function tokenResetValido(token: string, now = Date.now()): boolean {
  if (!token || token.length > 200) return false;
  const row = db.prepare(`SELECT 1 FROM reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).get(sha(token), now);
  return !!row;
}

/** Consome o link (uso único). Retorna false se já foi usado, expirou ou não existe. */
export function consumirTokenReset(token: string, now = Date.now()): boolean {
  if (!token || token.length > 200) return false;
  const r = db.prepare(`UPDATE reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).run(now, sha(token), now);
  return r.changes > 0;
}

export const RESET_VALIDADE_MIN = RESET_MINUTOS;
