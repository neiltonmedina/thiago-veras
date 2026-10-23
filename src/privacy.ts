import type { Request, Response } from 'express';

// Página exigida pela Meta pra colocar o app do WhatsApp no modo "Ao vivo".
export function privacyPage(_req: Request, res: Response): void {
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Política de privacidade — Casas do Litoral PI</title>
<style>
  body { font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #14302f; background: #f4f6f5;
         max-width: 720px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 24px; } h2 { font-size: 18px; margin-top: 28px; }
</style>
</head>
<body>
<h1>Política de privacidade</h1>
<p>Esta política explica como o atendimento por WhatsApp das <strong>Casas do Litoral PI</strong> trata os seus dados.</p>

<h2>Dados que coletamos</h2>
<p>Seu número de WhatsApp, as mensagens que você envia ao nosso atendimento e, se você fizer uma reserva,
seu nome completo, CPF e as datas escolhidas.</p>

<h2>Para que usamos</h2>
<p>Para responder suas perguntas, apresentar as casas, registrar e confirmar reservas e emitir a cobrança do Pix.
Não usamos seus dados para outras finalidades nem os vendemos.</p>

<h2>Com quem compartilhamos</h2>
<p>Com a Meta (WhatsApp), que transmite as mensagens; com o Google (Gemini), que nos ajuda a entender o texto das
mensagens; e com a Efí, instituição de pagamento que gera o Pix. Cada uma trata os dados conforme suas próprias políticas.</p>

<h2>Por quanto tempo guardamos</h2>
<p>Os dados de reserva ficam guardados enquanto forem necessários para a hospedagem e para obrigações legais.
Conversas sem reserva não são armazenadas além do necessário para o atendimento.</p>

<h2>Seus direitos</h2>
<p>Conforme a Lei Geral de Proteção de Dados (LGPD), você pode pedir acesso, correção ou exclusão dos seus dados
mandando uma mensagem para o nosso WhatsApp e pedindo para falar com o atendente.</p>
</body>
</html>`);
}
