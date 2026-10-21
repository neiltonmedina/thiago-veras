#!/usr/bin/env bash
# Setup pra Oracle Cloud Free Tier — Ubuntu 22.04/24.04 (arm64 ou amd64).
# Roda uma vez, como root, numa VM recém-criada:
#
#   curl -fsSL https://raw.githubusercontent.com/neiltonmedina/thiago-veras/main/scripts/setup-vps.sh | sudo bash
#
# Pra instalar de outra branch:  ... | sudo REPO_BRANCH=minha-branch bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/neiltonmedina/thiago-veras.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/thiago-veras}"
APP_USER="${APP_USER:-thiagoveras}"

echo "▶ Atualizando sistema..."
apt-get update -y
apt-get upgrade -y

echo "▶ Instalando dependências base..."
# build-essential/python3: o better-sqlite3 compila nativo quando não há binário pronto (comum em ARM)
apt-get install -y curl git ca-certificates gnupg build-essential python3

echo "▶ Instalando Docker + Compose..."
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "▶ Instalando Node.js 22 LTS..."
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "▶ Criando usuário de aplicação: ${APP_USER}"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${APP_USER}"
  usermod -aG docker "${APP_USER}"
fi

echo "▶ Clonando repo (${REPO_BRANCH}) em ${APP_DIR}..."
if [ ! -d "${APP_DIR}" ]; then
  git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${APP_DIR}"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
fi

echo "▶ Configurando firewall (80/443 públicas; 3000 só pros containers)..."
# Portas 3000 (backend) e 8080 (Evolution) NÃO ficam públicas.
# O container do Evolution acessa o backend pela rede do Docker (172.16.0.0/12).
if [ -f /etc/iptables/rules.v4 ]; then
  # Imagens Ubuntu da Oracle já vêm com iptables que rejeita tudo menos SSH,
  # e o ufw conflita com essas regras. Abrimos só o necessário no topo da cadeia.
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  done
  iptables -C INPUT -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT
  netfilter-persistent save
else
  apt-get install -y ufw
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow from 172.16.0.0/12 to any port 3000 proto tcp
  ufw --force enable
fi

echo "▶ Criando serviço systemd thiago-veras..."
cat >/etc/systemd/system/thiago-veras.service <<UNIT
[Unit]
Description=Thiago Veras — agente WhatsApp de aluguéis
After=network.target docker.service
Requires=docker.service

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

cat <<EOF

✅ Provisionamento concluído.

Próximos passos (detalhados no README, seção "Deploy"):

1. Configurações:
     cd ${APP_DIR}
     sudo -u ${APP_USER} cp .env.example .env
     sudo -u ${APP_USER} cp docker/.env.example docker/.env
     sudo -u ${APP_USER} nano .env          # GEMINI_API_KEY, SUPPORT_PHONE, ADMIN_PASSWORD...
     sudo -u ${APP_USER} nano docker/.env   # AUTHENTICATION_API_KEY (= EVOLUTION_API_KEY), DOMAIN

2. Subir Evolution API (+ HTTPS do painel, se tiver DOMAIN):
     cd ${APP_DIR}/docker && sudo -u ${APP_USER} docker compose --profile https up -d

3. Build e start do backend:
     cd ${APP_DIR}
     sudo -u ${APP_USER} npm ci
     sudo -u ${APP_USER} npm run build
     sudo systemctl enable --now thiago-veras
     curl http://localhost:3000/health

4. Conectar o WhatsApp (precisa do chip):
     No SEU computador: ssh -L 8080:localhost:8080 ubuntu@<IP_DA_VM>
     Abra http://localhost:8080/manager, crie a instance "anfitriao",
     escaneie o QR Code e configure o webhook:
       URL:    http://host.docker.internal:3000/webhook/messages?token=<WEBHOOK_TOKEN do .env>
       Evento: MESSAGES_UPSERT

EOF
