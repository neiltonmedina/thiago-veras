#!/usr/bin/env bash
# PLANO B: se ninguém lembra a senha do painel e o e-mail não funciona.
# Cria uma senha nova aleatória, apaga a senha trocada pelo painel, desconecta todos os aparelhos
# e mostra a senha UMA vez.
#
#   ssh -t -i ~/.ssh/neilton-vm ubuntu@163.176.74.32 'sudo bash /opt/thiago-veras/scripts/resetar-senha.sh'

APP=/opt/thiago-veras
E=$APP/.env
DB=$APP/data/thiago-veras.db
[ -f "$E" ] || { echo "❌ Não achei $E"; exit 1; }

P=$(openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 16)
sed -i '/^ADMIN_PASSWORD=/d' "$E"
printf 'ADMIN_PASSWORD=%s\n' "$P" >> "$E"
chown thiagoveras:thiagoveras "$E"; chmod 600 "$E"

# apaga a senha trocada pelo painel (se existir) e muda a "época" para derrubar as sessões abertas
if [ -f "$DB" ] && command -v sqlite3 >/dev/null; then
  sqlite3 "$DB" "DELETE FROM admin_settings WHERE key='password_hash'; INSERT INTO admin_settings(key,value) VALUES('session_epoch', hex(randomblob(12))) ON CONFLICT(key) DO UPDATE SET value=excluded.value;" 2>/dev/null
fi
systemctl restart thiago-veras
sleep 4

echo
echo "🔑 SENHA NOVA DO PAINEL:  $P"
echo "   usuário: thiago"
echo "   (anote agora; ela não aparece de novo. Depois, entre e troque por uma sua em Menu → Trocar senha.)"
