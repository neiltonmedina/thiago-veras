#!/usr/bin/env bash
# Atualiza o servidor na VM com a versão mais recente do GitHub, ajusta as
# configurações e religa tudo. Pode rodar quantas vezes precisar.
#
#   sudo -u thiagoveras git -C /opt/thiago-veras pull -q && bash /opt/thiago-veras/scripts/atualizar-vm.sh
#
# Não faz perguntas: se ainda não existe senha do painel, cria uma e mostra no fim.

APP=/opt/thiago-veras
E=$APP/.env
DOMINIO=163-176-74-32.sslip.io
LOG=/tmp/atualizar-vm.log
: > "$LOG"

falha() { echo; echo "❌ $1"; [ -s "$LOG" ] && { echo "--- últimas linhas do registro ---"; tail -15 "$LOG"; }; exit 1; }
setv() { sudo sed -i "/^$1=/d" "$E"; printf '%s=%s\n' "$1" "$2" | sudo tee -a "$E" >/dev/null; }

[ -d "$APP" ] || falha "Não achei $APP. O setup-vps.sh foi executado nesta máquina?"

echo "▶ Baixando a versão mais recente..."
sudo -u thiagoveras git -C "$APP" pull -q >>"$LOG" 2>&1 || falha "Não consegui baixar do GitHub."
echo "   versão: $(sudo -u thiagoveras git -C "$APP" log --oneline -1)"

echo "▶ Instalando e compilando (leva uns 2 minutos)..."
( cd "$APP" \
  && sudo -u thiagoveras npm ci --no-audit --no-fund \
  && sudo -u thiagoveras npm run build ) >>"$LOG" 2>&1 || falha "Erro ao instalar ou compilar."

echo "▶ Configurando..."
[ -f "$E" ] || { sudo -u thiagoveras cp "$APP/.env.example" "$E"; }
SENHA_NOVA=""
if ! sudo grep -q '^ADMIN_PASSWORD=.\{8,\}' "$E"; then
  SENHA_NOVA=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)
  setv ADMIN_PASSWORD "$SENHA_NOVA"
fi
setv ADMIN_USER thiago
setv SUPPORT_PHONE 5586998662992
setv MEDIA_BASE_URL "https://$DOMINIO/media"
setv HOLD_MINUTES 120
setv WEB_ORIGINS https://thiagoverasempreendimentos.github.io
# WhatsApp da Meta fica desligado: os quatro campos precisam estar vazios
for v in WHATSAPP_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_VERIFY_TOKEN WHATSAPP_APP_SECRET; do
  sudo sed -i "/^$v=/d" "$E"
done
# Sem credenciais da Efí, o caminho de exemplo do certificado fica vazio (Pix manual)
sudo grep -q '^EFI_CLIENT_ID=.\+' "$E" || sudo sed -i 's#^EFI_CERT_PATH=.*#EFI_CERT_PATH=#' "$E"
sudo chmod 600 "$E"; sudo chown thiagoveras:thiagoveras "$E"

echo "▶ Atualizando o HTTPS..."
sed "s/__DOMAIN__/$DOMINIO/" "$APP/deploy/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy >>"$LOG" 2>&1 || falha "O Caddy recusou a configuração."

echo "▶ Ligando o servidor..."
sudo systemctl restart thiago-veras >>"$LOG" 2>&1
sleep 6

echo
echo "──────────── RESULTADO ────────────"
LOCAL=$(curl -s -m 8 http://127.0.0.1:3000/health)
PUBLICO=$(curl -s -m 12 "https://$DOMINIO/api/disponibilidade")
echo "Servidor:  ${LOCAL:-sem resposta}"
echo "API:       ${PUBLICO:-sem resposta}"
echo
sudo journalctl -u thiago-veras -n 7 --no-pager | tail -7
echo "────────────────────────────────────"
if [ -n "$SENHA_NOVA" ]; then
  echo
  echo "🔑 Painel do Thiago:  https://$DOMINIO/admin"
  echo "   usuário: thiago"
  echo "   senha:   $SENHA_NOVA     ← ANOTE AGORA, ela não aparece de novo"
else
  echo
  echo "🔑 Painel: https://$DOMINIO/admin (usuário thiago, a senha que já existia foi mantida)"
fi
case "$LOCAL$PUBLICO" in
  *'"ok":true'*'"casas"'*) echo; echo "✅ Tudo no ar." ;;
  *) echo; echo "⚠️  Algo não respondeu como esperado. Me mande o texto acima." ; exit 1 ;;
esac
