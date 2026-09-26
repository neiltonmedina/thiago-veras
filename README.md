# Anfitrião no WhatsApp

Agente WhatsApp para gerenciar aluguel de casas de temporada no litoral do Piauí.
Apresenta as casas, envia fotos e vídeos, e (nas próximas fases) fecha a reserva
com Pix automático.

**Status atual:** Fase 1 — apresentação das casas.

## Stack (100% free tier)

| Camada | Ferramenta | Custo |
|---|---|---|
| Servidor | Oracle Cloud Free Tier (ARM 24 GB RAM) | R$ 0/mês |
| WhatsApp | Evolution API (open source, self-hosted) | R$ 0/mês |
| Backend | Node.js 20 + TypeScript | R$ 0 |
| IA da conversa | Google Gemini 2.5 Flash (1500 req/dia grátis) | R$ 0/mês |
| Storage de mídia | próprio VPS (200 GB grátis) | R$ 0/mês |

## Setup local (rodar na sua máquina)

Requisitos: **Node 20+**, **Docker** e **Docker Compose**.

```bash
git clone https://github.com/neiltonmedina/thiago-veras.git
cd thiago-veras

# 1. Instala dependências do backend
npm install

# 2. Sobe Evolution API (WhatsApp) + Postgres + Redis
cp docker/.env.example docker/.env
cd docker && docker compose up -d && cd ..

# 3. Conecta o WhatsApp
# Abre http://localhost:8080/manager, cria uma instance chamada "anfitriao"
# e escaneia o QR Code com o WhatsApp do chip do negócio.

# 4. Configura env do backend
cp .env.example .env
# → edita .env preenchendo GEMINI_API_KEY (pegue em https://aistudio.google.com/apikey)
# → EVOLUTION_API_KEY é a mesma que colocou em docker/.env

# 5. Roda o backend
npm run dev
```

Depois, no painel da Evolution API, configure o webhook:
- URL: `http://host.docker.internal:3000/webhook/messages` (ou o IP da sua máquina)
- Eventos: `MESSAGES_UPSERT`

Manda um "oi" pro número conectado — o agente deve responder com o menu de casas.

## Setup em produção (Oracle Cloud Free Tier)

Ver [`scripts/setup-vps.sh`](scripts/setup-vps.sh) — script pronto pra rodar
numa VM Ubuntu 22.04 recém-criada da Oracle. Ele instala Docker, Node, clona
o repo, sobe tudo e configura systemd pra reiniciar automaticamente.

## Estrutura

```
src/
├── index.ts                  # servidor Express (webhook + health)
├── config.ts                 # env vars validadas com zod
├── types.ts                  # tipos compartilhados
├── whatsapp/
│   ├── evolution.ts          # cliente HTTP da Evolution API
│   └── webhook.ts            # recebe mensagens inbound
├── conversation/
│   ├── handler.ts            # despacha a mensagem
│   ├── matcher.ts            # match fuzzy de casa (código/nome/keyword)
│   ├── messages.ts           # templates de mensagem (saudação, ficha, etc.)
│   └── state.ts              # estado da conversa (in-memory)
├── houses/
│   ├── catalog.ts            # carrega catálogo
│   └── data.json             # 5 casas placeholder (editar com dados reais)
└── ai/
    └── gemini.ts             # classificador de intenção via Gemini
docker/
├── docker-compose.yml        # Evolution API + Postgres + Redis
└── .env.example
scripts/
└── setup-vps.sh              # provisionamento Oracle Cloud
```

## Cadastrando as 5 casas

Edite `src/houses/data.json`. Cada casa tem:

```json
{
  "code": "C01",
  "name": "Casa Beira-Mar",
  "city": "Luís Correia",
  "bedrooms": 3,
  "capacity": 8,
  "amenities": ["🏊 piscina", "🚗 2 vagas", "❄️ ar-condicionado"],
  "dailyPrice": 450,
  "weekendPrice": 1800,
  "description": "Casa a 100m da praia, ampla varanda com rede.",
  "photos": ["c01/foto1.jpg", "c01/foto2.jpg", "c01/foto3.jpg"],
  "video": "c01/tour.mp4",
  "mapsUrl": "https://maps.app.goo.gl/xxx",
  "keywords": ["beira mar", "praia", "luis correia", "atalaia"]
}
```

As `photos` e `video` são caminhos relativos ao `MEDIA_BASE_URL` do `.env`.
Em produção, sobem pro próprio VPS servindo estáticos (ou Cloudinary/S3 se
preferir).

## Roadmap

- [x] **Fase 1** — Apresentação das casas (código atual)
- [ ] **Fase 2** — Consulta de disponibilidade + pré-reserva (calendário)
- [ ] **Fase 3** — Pix automático via Efí + painel web de reservas

## Licença

Uso privado — proprietário do cliente contratante.
