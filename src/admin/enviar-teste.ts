/**
 * Manda um e-mail de teste para o e-mail do Thiago, para conferir se a conta de envio está certa.
 * Uso na VM: cd /opt/thiago-veras && sudo -u thiagoveras node dist/admin/enviar-teste.js
 */
import { config } from '../config.js';
import { enviarEmail } from './mailer.js';

if (!config.mail.enabled || !config.admin?.email) {
  console.error('❌ Faltam ADMIN_EMAIL, SMTP_USER e SMTP_PASS no .env.');
  process.exit(1);
}
const para = config.admin.email;
try {
  await enviarEmail({
    to: para,
    subject: 'Teste do painel de reservas',
    text: 'Se você recebeu esta mensagem, o envio de e-mail do painel está funcionando.\nO link de "esqueci minha senha" chegará neste endereço.',
    html: '<p>Se você recebeu esta mensagem, o envio de e-mail do painel está funcionando.</p><p>O link de <b>esqueci minha senha</b> chegará neste endereço.</p>',
  });
  console.log(`✅ E-mail de teste enviado para ${para}. Confira a caixa de entrada (e o spam).`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`❌ Não consegui enviar: ${msg}`);
  if (/Invalid login|535|Username and Password not accepted/i.test(msg)) console.error('   Dica: confira se usou a SENHA DE APP (16 letras) e não a senha normal do Gmail.');
  if (/ETIMEDOUT|ECONNREFUSED|ENETUNREACH|ESOCKET/i.test(msg)) console.error('   Dica: a VM não conseguiu falar com o servidor de e-mail. Confira o host e a porta.');
  process.exit(1);
}
