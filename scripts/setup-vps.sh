#!/usr/bin/env bash
# Setup pra Oracle Cloud Free Tier — Ubuntu 22.04 LTS (arm64 ou amd64).
# Roda uma vez, como root ou com sudo, numa VM recém-criada.
#
#   curl -fsSL https://raw.githubusercontent.com/neiltonmedina/thiago-veras/main/scripts/setup-vps.sh | sudo bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/neiltonmedina/thiago-veras.git}"
APP_DIR="${APP_DIR:-/opt/thiago-veras}"
APP_USER="${APP_USER:-thiagoveras}"

echo "▶ Atualizando sistema..."
apt-get update -y
apt-get upgrade -y

echo "▶ Instalando dependências base..."
apt-get install -y curl git ca-certificates gnupg ufw

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

echo "▶ Instalando Node.js 20 LTS..."
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "▶ Criando usuário de aplicação: ${APP_USER}"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${APP_USER}"
  usermod -aG docker "${APP_USER}"
fi

echo "▶ Clonando repo em ${APP_DIR}..."
if [ ! -d "${APP_DIR}" ]; then
  git clone "${REPO_URL}" "${APP_DIR}"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
fi

echo "▶ Configurando firewall (portas 22, 3000, 8080)..."
ufw allow 22/tcp || true
ufw allow 3000/tcp || true
ufw allow 8080/tcp || true
ufw --force enable || true

echo "▶ Criando serviço systemd thiago-veras..."
cat >/etc/systemd/system/thiago-veras.service <<UNIT
[Unit]
Description=Thiago Veras — agente WhatsApp de alugueis
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

Próximos passos manuais:

1. Copie e edite as configurações:
     cd ${APP_DIR}
     sudo -u ${APP_USER} cp .env.example .env
     sudo -u ${APP_USER} cp docker/.env.example docker/.env
     # Edite os dois arquivos, principalmente:
     #   - AUTHENTICATION_API_KEY (docker/.env) e EVOLUTION_API_KEY (.env) devem ser iguais
     #   - GEMINI_API_KEY: pegue em https://aistudio.google.com/apikey
     #   - SUPPORT_PHONE: seu WhatsApp pra receber alertas
     #   - MEDIA_BASE_URL: http://<IP_DA_VM>:3000/media (ou seu domínio)

2. Suba Evolution API:
     cd ${APP_DIR}/docker && sudo -u ${APP_USER} docker compose up -d

3. Conecte o WhatsApp:
     Abra http://<IP_DA_VM>:8080/manager no navegador.
     Cria instance "anfitriao", escaneia o QR Code com o chip do negócio.
     Configure webhook: http://localhost:3000/webhook/messages
     Evento: MESSAGES_UPSERT

4. Build + start do backend:
     cd ${APP_DIR}
     sudo -u ${APP_USER} npm install
     sudo -u ${APP_USER} npm run build
     sudo systemctl enable --now thiago-veras

5. Verificar:
     curl http://localhost:3000/health

EOF
