#!/usr/bin/env bash
# Instala o agente numa VM Ubuntu 22.04/24.04 recém-criada (Oracle Free Tier
# E2.1.Micro com 1 GB funciona). Roda uma vez, como root.
#
# O repositório é privado, então o script e o código são baixados com um token
# de leitura do GitHub (passo a passo no README, seção "Deploy"):
#
#   export GITHUB_TOKEN=github_pat_...
#   curl -fsSL -H "Authorization: token $GITHUB_TOKEN" \
#     https://raw.githubusercontent.com/neiltonmedina/thiago-veras/main/scripts/setup-vps.sh | sudo -E bash
#
# Variáveis opcionais: REPO_BRANCH (padrão main), DOMAIN (padrão: IP público com sslip.io)

set -euo pipefail

REPO="neiltonmedina/thiago-veras"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/thiago-veras}"
APP_USER="${APP_USER:-thiagoveras}"
: "${GITHUB_TOKEN:?Defina GITHUB_TOKEN (token de leitura do GitHub) e rode com sudo -E}"

echo "▶ Memória extra (swap de 2 GB) — necessária em VMs de 1 GB pra compilar"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "▶ Atualizando sistema e instalando dependências..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
# build-essential/python3: better-sqlite3 compila nativo quando não há binário pronto
apt-get install -y curl git ca-certificates gnupg build-essential python3 sqlite3 \
  unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https

echo "▶ Atualizações de segurança automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "▶ Node.js 22 LTS"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "▶ Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "▶ Usuário da aplicação: ${APP_USER}"
id -u "${APP_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${APP_USER}"

echo "▶ Baixando o código (${REPO_BRANCH})..."
if [ ! -d "${APP_DIR}" ]; then
  mkdir -p "${APP_DIR}"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}"
  # Token guardado só pro usuário da aplicação, pra `git pull` funcionar nas atualizações
  sudo -H -u "${APP_USER}" bash -c "
    umask 077
    git config --global credential.helper store
    printf 'https://x-access-token:%s@github.com\n' '${GITHUB_TOKEN}' > ~/.git-credentials
    git clone --branch '${REPO_BRANCH}' 'https://github.com/${REPO}.git' '${APP_DIR}'
  "
fi

echo "▶ Instalando dependências e compilando (pode levar alguns minutos)..."
cd "${APP_DIR}"
sudo -H -u "${APP_USER}" npm ci --no-audit --no-fund
sudo -H -u "${APP_USER}" npm run build
sudo -H -u "${APP_USER}" mkdir -p data
[ -f .env ] || sudo -H -u "${APP_USER}" cp .env.example .env
chmod 600 .env

echo "▶ Domínio e HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
sed "s/__DOMAIN__/${DOMAIN}/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "▶ Firewall: só SSH, 80 e 443"
if [ -f /etc/iptables/rules.v4 ]; then
  # Imagens Ubuntu da Oracle já vêm com iptables que só libera SSH; o ufw conflita com elas
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  netfilter-persistent save
else
  apt-get install -y ufw
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "▶ Serviço systemd"
cat >/etc/systemd/system/thiago-veras.service <<UNIT
[Unit]
Description=Thiago Veras — agente WhatsApp de aluguéis
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable thiago-veras >/dev/null

echo "▶ Backup diário do banco (guarda 14 dias em /var/backups/thiago-veras)"
mkdir -p /var/backups/thiago-veras
cat >/etc/cron.daily/thiago-veras-backup <<CRON
#!/bin/sh
DB=${APP_DIR}/data/thiago-veras.db
[ -f "\$DB" ] || exit 0
sqlite3 "\$DB" ".backup /var/backups/thiago-veras/reservas-\$(date +%F).db"
find /var/backups/thiago-veras -name 'reservas-*.db' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/thiago-veras-backup

cat <<EOF

✅ Instalação concluída. Domínio: https://${DOMAIN}

Próximos passos:

1. Preencha as configurações (WhatsApp da Meta, Gemini, telefone do atendente, senha do painel):
     sudo -u ${APP_USER} nano ${APP_DIR}/.env
   Use MEDIA_BASE_URL=https://${DOMAIN}/media

2. Ligue o agente:
     sudo systemctl start thiago-veras
     curl https://${DOMAIN}/health

3. No painel da Meta, cadastre o webhook:
     URL:          https://${DOMAIN}/webhook/whatsapp
     Verify token: o mesmo de WHATSAPP_VERIFY_TOKEN no .env
     Campo:        messages

Painel do Thiago: https://${DOMAIN}/admin
Logs:             sudo journalctl -u thiago-veras -f
EOF
