# Anfitrião no WhatsApp — Casas do Litoral PI

Agente de WhatsApp que atende 24h os clientes das casas de temporada do Thiago
no litoral do Piauí: apresenta as casas com fotos e vídeo, consulta datas, faz a
pré-reserva e cobra o sinal por Pix, confirmando sozinho quando o pagamento cai.

## Status

- [x] **Fase 1** — Apresentação das casas (código, nome ou local em linguagem natural)
- [x] **Fase 2** — Datas em português, disponibilidade, pré-reserva com nome e CPF
- [x] **Fase 3** — Pix automático do sinal via Efí + painel `/admin` pro Thiago
- [ ] **Lançamento** — chip do WhatsApp, VM na Oracle, fotos e dados reais das casas

## Testar sem chip, sem servidor e sem chaves

```bash
npm install
npm run simulate
```

Roda 20 conversas de ponta a ponta (reserva, Pix, "paguei", expiração, conflito
de datas, bloqueio pelo painel) e mostra o que o bot responderia. Nada sai do
computador: WhatsApp, Gemini e Pix são simulados e o banco fica em memória.

## Stack

| Camada | Ferramenta | Custo mensal |
|---|---|---|
| Servidor | Oracle Cloud Free Tier (VM ARM) | R$ 0 |
| WhatsApp | Evolution API (Docker, self-hosted) | R$ 0 |
| Backend | Node.js 22 + TypeScript | R$ 0 |
| IA da conversa | Google Gemini 2.5 Flash (cota grátis) | R$ 0 |
| Banco | SQLite (arquivo local) | R$ 0 |
| Pix | Efí | tarifa por Pix recebido |

## Como funciona

```
Cliente no WhatsApp
   ↓
Evolution API (Docker, só localhost:8080)
   ↓ webhook http://host.docker.internal:3000/webhook/messages?token=…
Backend Node (porta 3000, fechada pra internet)
   ├─ conversa: matcher de casas, Gemini, parser de datas, estado da conversa
   ├─ reservas: SQLite, conflito de datas, pré-reserva de 30 min
   ├─ Pix: cobra o sinal na Efí, confere a cada minuto e quando o cliente diz "paguei"
   └─ painel /admin ← Caddy com HTTPS (portas 80/443)
```

O pagamento é confirmado por **consulta periódica** à Efí, não por webhook. Assim
o Pix funciona sem precisar de domínio e certificado só pra isso.

### O que o bot faz sozinho

| Situação | Ação |
|---|---|
| Cliente fecha a pré-reserva | Gera Pix do sinal (`DEPOSIT_PERCENT`, padrão 50%), envia QR + copia e cola, avisa o Thiago |
| Pix cai | Confirma a reserva e avisa cliente e Thiago |
| Cliente diz "paguei" | Consulta a Efí na hora |
| 30 min sem pagamento | Libera a data e avisa o cliente |
| Pagou depois de expirar, data livre | Confirma normalmente |
| Pagou depois de expirar, data já ocupada | Não confirma; avisa o Thiago pra remarcar ou devolver |
| Efí fora do ar ou Pix desligado | Pré-reserva normal; Thiago combina o pagamento e confirma no painel |

### Painel `/admin`

Feito pro celular. Login com `ADMIN_USER` / `ADMIN_PASSWORD`.

- Lista reservas aguardando pagamento, confirmadas e o histórico recente
- **Confirmar** (pagamento por fora do Pix) e **Cancelar**, avisando o cliente no WhatsApp
- **Bloquear datas**: reservas feitas pelo Airbnb, telefone ou uso próprio. Sem isso o bot pode vender uma data já ocupada em outro canal.

## Deploy na Oracle Cloud

### 1. VM

Na Oracle: Compute → Instances → Create instance, **Ubuntu 22.04**, shape
**VM.Standard.A1.Flex** (2 OCPU / 12 GB basta), IP público, baixe a chave SSH.
Na Security List da subnet, libere as portas **80 e 443**. Não libere 3000 nem 8080.

### 2. Provisionar

```bash
ssh -i chave.key ubuntu@IP_DA_VM
curl -fsSL https://raw.githubusercontent.com/neiltonmedina/thiago-veras/main/scripts/setup-vps.sh | sudo bash
```

Instala Docker, Node 22 e o repo em `/opt/thiago-veras`, ajusta o firewall da
imagem da Oracle e cria o serviço `thiago-veras` no systemd.

### 3. Configurar

```bash
cd /opt/thiago-veras
sudo -u thiagoveras cp .env.example .env && sudo -u thiagoveras nano .env
sudo -u thiagoveras cp docker/.env.example docker/.env && sudo -u thiagoveras nano docker/.env
```

Gere segredos com `openssl rand -hex 24` para `AUTHENTICATION_API_KEY`
(igual em `EVOLUTION_API_KEY`), `WEBHOOK_TOKEN` e `ADMIN_PASSWORD`.

Sem domínio próprio, use o IP da VM com sslip.io em `DOMAIN`:
o IP `129.151.40.12` vira `129-151-40-12.sslip.io`.

### 4. Subir

```bash
cd /opt/thiago-veras/docker && sudo -u thiagoveras docker compose --profile https up -d
cd /opt/thiago-veras && sudo -u thiagoveras npm ci && sudo -u thiagoveras npm run build
sudo systemctl enable --now thiago-veras
curl http://localhost:3000/health
```

O painel fica em `https://SEU-DOMINIO/admin`.

### 5. Conectar o WhatsApp (precisa do chip)

O painel do Evolution não fica exposto. Acesse por túnel SSH, do seu computador:

```bash
ssh -i chave.key -L 8080:localhost:8080 ubuntu@IP_DA_VM
```

Abra `http://localhost:8080/manager`, crie a instance `anfitriao`, escaneie o QR
Code com o WhatsApp do chip e configure o webhook:

- URL: `http://host.docker.internal:3000/webhook/messages?token=SEU_WEBHOOK_TOKEN`
- Evento: `MESSAGES_UPSERT`

### Atualizar depois

```bash
cd /opt/thiago-veras && sudo -u thiagoveras git pull
sudo -u thiagoveras npm ci && sudo -u thiagoveras npm run build
sudo systemctl restart thiago-veras
```

### Backup

Todas as reservas ficam em `data/thiago-veras.db`. Copie esse arquivo
periodicamente pra fora da VM.

## Pix (Efí)

1. O Thiago abre uma conta na Efí (app Efí Bank) e cadastra uma chave Pix.
2. No painel da Efí, em **API → Aplicações**, cria uma aplicação com os escopos
   de cobrança Pix (`cob.write`, `cob.read`) e anota Client ID e Client Secret
   de **produção**.
3. Em **API → Meus Certificados**, gera o certificado de **produção** e baixa o `.p12`.
4. Copie o `.p12` pra VM em `/opt/thiago-veras/certs/` (a pasta fica fora do git).
5. Preencha `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_CERT_PATH` e `EFI_PIX_KEY`
   no `.env` e reinicie o serviço.

Os nomes dos menus podem mudar. A referência é a documentação oficial:
https://dev.efipay.com.br/docs/api-pix/credenciais

Pra testar sem dinheiro real, use credenciais e certificado de **homologação**
com `EFI_SANDBOX=true`.

## Casas e fotos

- Dados das casas: `src/houses/data.json` (nome, local, quartos, preço, comodidades, palavras-chave)
- Fotos e vídeos: `media/<código>/` — veja `media/README.md`
- Conferir: `npm run check:media`

O preço da reserva é `diárias × dailyPrice`. O `weekendPrice` aparece só como
informação na ficha da casa.

## Estrutura

```
src/
├── index.ts               servidor, jobs de expiração e de pagamento
├── config.ts              variáveis de ambiente validadas (zod)
├── simulate.ts            20 cenários de teste
├── whatsapp/              cliente da Evolution API e webhook
├── conversation/          handler, matcher, mensagens, estado
├── ai/gemini.ts           classificação de intenção (+ fallback sem IA)
├── dates/parser.ts        datas em português
├── db/index.ts            SQLite + migrações
├── reservations/          regras de reserva, ciclo de vida, CPF
├── pix/provider.ts        Efí (OAuth + certificado) e provedor simulado
└── admin/                 painel /admin
docker/                    Evolution, Postgres, Redis, Caddy
scripts/                   setup da VM e conferência de mídia
media/                     fotos e vídeos das casas
```
