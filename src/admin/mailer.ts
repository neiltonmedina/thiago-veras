/**
 * Envio de e-mail do painel (só o link de "esqueci minha senha").
 * Em simulação, nada sai: as mensagens ficam em `outbox` para os testes lerem.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';

export type Email = { to: string; subject: string; text: string; html: string };

export const outbox: Email[] = [];

let transporter: nodemailer.Transporter | null = null;
function smtp(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function enviarEmail(msg: Email): Promise<void> {
  if (config.simulate) { outbox.push(msg); return; }
  await smtp().sendMail({ from: config.mail.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function emailRedefinir(link: string, minutos: number): Email {
  const to = config.admin?.email ?? '';
  const texto = [
    'Olá!',
    '',
    'Recebemos um pedido para criar uma nova senha do painel de reservas da Thiago Veras Empreendimentos.',
    '',
    `Para criar a nova senha, abra o link (vale por ${minutos} minutos e só pode ser usado uma vez):`,
    link,
    '',
    'Se não foi você, ignore esta mensagem: a senha atual continua valendo.',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#1f1d1b">
  <h2 style="margin:0 0 12px">Nova senha do painel</h2>
  <p>Recebemos um pedido para criar uma nova senha do painel de reservas da <b>Thiago Veras Empreendimentos</b>.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#fd4f1a;color:#fff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:10px">Criar nova senha</a></p>
  <p style="color:#625b55;font-size:14px">O link vale por ${minutos} minutos e só pode ser usado uma vez.<br>Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all">${esc(link)}</span></p>
  <p style="color:#625b55;font-size:14px">Se não foi você, ignore esta mensagem: a senha atual continua valendo.</p></div>`;
  return { to, subject: 'Nova senha do painel de reservas', text: texto, html };
}
