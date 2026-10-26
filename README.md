# Anfitrião no WhatsApp — Casas do Litoral PI

Agente de WhatsApp que atende 24h os clientes das casas de temporada do Thiago
no litoral do Piauí: apresenta as casas com fotos e vídeo, consulta datas, faz a
pré-reserva e cobra o sinal por Pix, confirmando sozinho quando o pagamento cai.

Usa a **API oficial do WhatsApp (Cloud API, da Meta)**: sem risco de banimento do
número, sem QR Code pra reconectar, e leve o bastante pra rodar na VM grátis de
1 GB da Oracle.

## Status

- [x] **Fase 1** — Apresentação das casas (código, nome ou local em linguagem natural)
- [x] **Fase 2** — Datas em português, disponibilidade, pré-reserva com nome e CPF
- [x] **Fase 3** — Pix automático do sinal via Efí + painel `/admin` pro Thiago
- [ ] **Lançamento** — VM, app da Meta com o número do negócio, fotos e dados reais

## Testar sem nada configurado

```bash
npm install
npm run simulate
```

Roda 20 conversas de ponta a ponta (reserva, Pix, "paguei", expiração, conflito
de datas, bloqueio pelo painel). WhatsApp, Gemini e Pix são simulados e o banco
fica em memória.

## Stack e custos

| Camada | Ferramenta | Custo mensal |
|---|---|---|
| Servidor | Oracle Cloud Always Free (VM.Standard.E2.1.Micro, 1 GB) | R$ 0 |
| WhatsApp | Cloud API oficial da Meta | R$ 0 pra responder clientes* |
| Backend | Node.js 22 + TypeScript, SQLite | R$ 0 |
| HTTPS | Caddy + domínio sslip.io (ou próprio) | R$ 0 |
| IA da conversa | Google Gemini 2.5 Flash (cota grátis) | R$ 0 |
| Pix | Efí | tarifa por Pix recebido |

\* Mensagens em resposta ao cliente, dentro da janela de 24h desde a última
mensagem dele, são grátis. Avisos fora dessa janela (template) são cobrados pela
Meta, centavos por mensagem, e exigem forma de pagamento na conta do WhatsApp
Business. Confira a tabela atual em developers.facebook.com.

## Como funciona

```
Cliente no WhatsApp
   ↓ (Meta)
https://SEU-DOMINIO/webhook/whatsapp   ← assinatura HMAC conferida
   ↓ Caddy (HTTPS, portas 80/443)
Backend Node (127.0.0.1:3000)
   ├─ conversa: matcher de casas, Gemini, datas em português, estado da conversa
   ├─ reservas: SQLite, conflito de datas, pré-reserva com prazo (`HOLD_MINUTES`, padrão 30 min)
   ├─ Pix: cobra o sinal na Efí, confere a cada minuto e quando o cliente diz "paguei"
   └─ painel /admin
```

### O que o bot faz sozinho

| Situação | Ação |
|---|---|
| Cliente fecha a pré-reserva | Gera Pix do sinal (`DEPOSIT_PERCENT`, padrão 50%), envia QR + copia e cola, avisa o Thiago |
| Pix cai | Confirma a reserva e avisa cliente e Thiago |
| Cliente diz "paguei" | Consulta a Efí na hora |
| Prazo (`HOLD_MINUTES`) sem pagamento | Libera a data e avisa o cliente |
| Pagou depois de expirar, data livre | Confirma normalmente |
| Pagou depois de expirar, data já ocupada | Não confirma; avisa o Thiago pra remarcar ou devolver |
| Efí fora do ar ou Pix desligado | Pré-reserva normal; Thiago combina o pagamento e confirma no painel |

### Painel `/admin`

Feito pro celular. Login com `ADMIN_USER` / `ADMIN_PASSWORD`.

- Reservas aguardando pagamento, confirmadas e histórico recente
- **Confirmar** e **Cancelar**, avisando o cliente no WhatsApp
- **Bloquear datas** de reservas feitas por outros canais (Airbnb, telefone, uso
  próprio), pra o bot não vender data ocupada

## Deploy

### 1. Criar a VM na Oracle (Cloud Shell)

No console da Oracle, abra o Cloud Shell (ícone `>_`), envie
`scripts/oracle-criar-vm.sh` (menu Ações → Upload) e rode:

```bash
nohup bash oracle-criar-vm.sh > criar-vm.log 2>&1 & tail -f criar-vm.log
```

Ele cria a rede, libera as portas 80/443, gera a chave SSH dentro do Cloud Shell
e tenta criar a VM `VM.Standard.E2.1.Micro` até conseguir. No fim mostra o IP.

### 2. Token de leitura do GitHub

O repositório é privado. Em github.com → Settings → Developer settings →
**Fine-grained tokens** → Generate new token:
- Repository access: **Only select repositories** → `thiago-veras`
- Permissions → Repository → **Contents: Read-only**

Guarde o token (começa com `github_pat_`). Não cole em chat nem em arquivos do repositório.

### 3. Instalar

Do Cloud Shell, entre na VM e rode a instalação:

```bash
ssh -i ~/.ssh/neilton-vm ubuntu@IP_DA_VM
export GITHUB_TOKEN=github_pat_...   # o token do passo 2
curl -fsSL -H "Authorization: token $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/neiltonmedina/thiago-veras/main/scripts/setup-vps.sh | sudo -E bash
```

Instala Node 22, Caddy (HTTPS automático), swap de 2 GB, atualizações automáticas
de segurança, backup diário do banco, firewall (só 22, 80 e 443) e o serviço
`thiago-veras`. O domínio padrão é o IP com sslip.io, ex.: `129-151-40-12.sslip.io`.

Pra instalar de outra branch: `... | sudo -E REPO_BRANCH=nome-da-branch bash`.

### 4. Configurar e ligar

```bash
sudo -u thiagoveras nano /opt/thiago-veras/.env    # ver seção "WhatsApp (Meta)"
sudo systemctl start thiago-veras
curl https://SEU-DOMINIO/health
```

### Atualizar depois

```bash
cd /opt/thiago-veras && sudo -H -u thiagoveras git pull
sudo -H -u thiagoveras npm ci && sudo -H -u thiagoveras npm run build
sudo systemctl restart thiago-veras
```

Logs: `sudo journalctl -u thiago-veras -f`

### Monitoramento

Cadastre `https://SEU-DOMINIO/health` num monitor gratuito (ex.: UptimeRobot)
pra receber alerta se o bot sair do ar.

## WhatsApp (Meta)

O número do chip fica dedicado à API: **não pode estar ativo no app WhatsApp**.
Se já estiver, apague a conta do WhatsApp nesse número antes.

1. **Portfólio empresarial:** crie em business.facebook.com.
2. **App:** developers.facebook.com → Meus apps → Criar app → caso de uso de
   **WhatsApp** (conectar-se com clientes) → vincule ao portfólio.
3. **Número de teste (opcional, pra testar já):** em WhatsApp → Configuração da
   API há um número de teste. Adicione seu celular como destinatário.
4. **Número do negócio:** WhatsApp → Configuração da API → Adicionar número →
   confirme por SMS ou ligação e defina o nome de exibição.
5. **Anote o Phone number ID** (é um ID, não o telefone) → `WHATSAPP_PHONE_NUMBER_ID`.
6. **Token permanente:** Configurações do negócio → Usuários do sistema →
   Adicionar (admin) → Adicionar ativos (o app e a conta do WhatsApp) →
   Gerar token com `whatsapp_business_messaging` e `whatsapp_business_management`,
   expiração **Nunca** → `WHATSAPP_TOKEN`.
7. **App Secret:** Configurações do app → Básico → `WHATSAPP_APP_SECRET`.
8. **Webhook:** WhatsApp → Configuração → URL de callback
   `https://SEU-DOMINIO/webhook/whatsapp`, token de verificação igual ao
   `WHATSAPP_VERIFY_TOKEN` → Verificar e salvar → assine o campo **messages**.
   O agente precisa estar ligado nessa hora.
9. **Modo ao vivo:** Configurações do app → Básico → URL da política de
   privacidade `https://SEU-DOMINIO/privacidade` → mude o app pra **Ao vivo**.
10. **Template de aviso (opcional):** WhatsApp Manager → Modelos de mensagem →
    Criar → categoria **Utilidade**, nome `aviso_atendente`, idioma Português (BR),
    corpo `Aviso do sistema de reservas: {{1}}`. Depois de aprovado, coloque
    `WHATSAPP_SUPPORT_TEMPLATE=aviso_atendente`.

Sem o template, os avisos pro Thiago vão como texto e **só chegam se ele tiver
mandado mensagem pro número do bot nas últimas 24h**. O painel `/admin` mostra
tudo de qualquer forma.

Os nomes dos menus da Meta mudam com frequência; a referência é
developers.facebook.com/docs/whatsapp/cloud-api.

## Pix (Efí)

1. O Thiago abre uma conta na Efí (app Efí Bank) e cadastra uma chave Pix.
2. No painel da Efí, em **API → Aplicações**, cria uma aplicação com os escopos
   de cobrança Pix (`cob.write`, `cob.read`) e anota Client ID e Client Secret de **produção**.
3. Em **API → Meus Certificados**, gera o certificado de **produção** e baixa o `.p12`.
4. Copie o `.p12` pra VM em `/opt/thiago-veras/certs/` (fora do git).
5. Preencha `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_CERT_PATH` e `EFI_PIX_KEY`
   no `.env` e reinicie o serviço.

Referência: https://dev.efipay.com.br/docs/api-pix/credenciais. Pra testar sem
dinheiro real, use credenciais de homologação com `EFI_SANDBOX=true`.

## Casas e fotos

- Dados das casas: `src/houses/data.json`
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
├── privacy.ts             política de privacidade (exigida pela Meta)
├── whatsapp/              cliente da Cloud API e webhook
├── conversation/          handler, matcher, mensagens, estado
├── ai/gemini.ts           classificação de intenção (+ fallback sem IA)
├── dates/parser.ts        datas em português
├── db/index.ts            SQLite + migrações
├── reservations/          regras de reserva, ciclo de vida, CPF
├── pix/provider.ts        Efí (OAuth + certificado) e provedor simulado
└── admin/                 painel /admin
deploy/Caddyfile           HTTPS e rotas públicas
scripts/                   criação da VM, instalação e conferência de mídia
media/                     fotos e vídeos das casas
```
