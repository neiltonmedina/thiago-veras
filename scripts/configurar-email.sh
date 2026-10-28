#!/usr/bin/env bash
# Liga o "esqueci minha senha" por e-mail: guarda a conta de envio no .env, reinicia e manda um teste.
#
#   ssh -t -i ~/.ssh/neilton-vm ubuntu@163.176.74.32 'sudo bash /opt/thiago-veras/scripts/configurar-email.sh'
#
# Gmail (padrão): use uma SENHA DE APP (myaccount.google.com/apppasswords), não a senha normal.
# Outro provedor (ex.: Brevo): SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 sudo -E bash configurar-email.sh

APP=/opt/thiago-veras
E=$APP/.env
[ -f "$E" ] || { echo "❌ Não achei $E"; exit 1; }
setv() { sed -i "/^$1=/d" "$E"; printf '%s=%s\n' "$1" "$2" >> "$E"; }

HOST=${SMTP_HOST:-smtp.gmail.com}
PORTA=${SMTP_PORT:-465}

echo "Vamos ligar o envio de e-mail do painel."
echo
read -rp "1) E-mail do Thiago (recebe o link para criar a senha nova): " DESTINO
DESTINO=$(printf '%s' "$DESTINO" | tr -d '[:space:]' | tr 'A-Z' 'a-z')
[[ "$DESTINO" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "❌ E-mail inválido: $DESTINO"; exit 1; }

read -rp "2) E-mail que ENVIA as mensagens (a conta Gmail que criou a senha de app): " ORIGEM
ORIGEM=$(printf '%s' "$ORIGEM" | tr -d '[:space:]' | tr 'A-Z' 'a-z')
[[ "$ORIGEM" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "❌ E-mail inválido: $ORIGEM"; exit 1; }

read -rsp "3) Senha de app (16 letras; pode colar; não aparece na tela): " SENHA; echo
SENHA=$(printf '%s' "$SENHA" | tr -d '[:space:]')
[[ "$SENHA" =~ ^[A-Za-z0-9._-]{8,}$ ]] || { echo "❌ A senha de app tem que ter só letras e números (16 letras no Gmail)."; exit 1; }

setv ADMIN_EMAIL "$DESTINO"
setv SMTP_HOST "$HOST"
setv SMTP_PORT "$PORTA"
setv SMTP_USER "$ORIGEM"
setv SMTP_PASS "$SENHA"
setv MAIL_FROM "Painel Thiago Veras <$ORIGEM>"
chown thiagoveras:thiagoveras "$E"; chmod 600 "$E"

echo
echo "▶ Reiniciando o servidor..."
systemctl restart thiago-veras
sleep 5
echo "▶ Mandando um e-mail de teste para $DESTINO..."
( cd "$APP" && sudo -u thiagoveras node dist/admin/enviar-teste.js )
STATUS=$?
echo
if [ $STATUS -eq 0 ]; then
  echo "✅ Pronto. A tela de entrada do painel agora mostra \"Esqueci minha senha\"."
else
  echo "⚠️  O e-mail de teste não saiu. Confira a senha de app e rode este comando de novo."
fi
exit $STATUS
