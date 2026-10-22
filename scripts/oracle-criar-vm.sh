#!/usr/bin/env bash
# Cria a VM grátis (Ampere A1) na Oracle Cloud, tentando de novo até haver vaga.
# Rodar no Cloud Shell do console da Oracle (ícone >_ no topo), que já vem
# autenticado na sua conta. Seguro rodar de novo: reaproveita rede e chave,
# e para sozinho se a VM já existir.
#
# Uso:  bash oracle-criar-vm.sh
# Opcional: VM_NAME=neilton OCPUS=1 MEMORY_GB=6 RETRY_SECONDS=60 bash oracle-criar-vm.sh

set -uo pipefail

VM_NAME="${VM_NAME:-neilton}"
OCPUS="${OCPUS:-1}"
MEMORY_GB="${MEMORY_GB:-6}"
RETRY_SECONDS="${RETRY_SECONDS:-60}"
SHAPE="VM.Standard.A1.Flex"
KEY="$HOME/.ssh/${VM_NAME}-vm"
C="${OCI_TENANCY:?Rode este script no Cloud Shell da Oracle}"

log() { echo "[$(date '+%d/%m %H:%M:%S')] $*"; }
die() { log "❌ $*"; exit 1; }

# Quota do Always Free: 4 OCPU e 24 GB somados entre todas as VMs A1
if (( OCPUS > 4 || MEMORY_GB > 24 )); then die "Acima do limite grátis (máx 4 OCPU / 24 GB)."; fi

# ---------- Chave SSH (fica no Cloud Shell, nunca sai de lá) ----------
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "${VM_NAME}-vm" -q || die "Falha ao gerar chave SSH."
  log "🔑 Chave SSH criada em $KEY"
else
  log "🔑 Usando chave existente $KEY"
fi

# ---------- VM já existe? ----------
existing=$(oci compute instance list -c "$C" --all 2>/dev/null \
  | jq -r --arg n "$VM_NAME" '[.data[]? | select(."display-name"==$n and (."lifecycle-state"|IN("RUNNING","PROVISIONING","STARTING")))][0].id // empty')
if [[ -n "$existing" ]]; then
  log "✅ A VM \"$VM_NAME\" já existe ($existing). Nada a fazer."
  ip=$(oci compute instance list-vnics --instance-id "$existing" | jq -r '.data[0]."public-ip" // "sem IP público"')
  log "🌐 IP público: $ip"
  exit 0
fi

AD=$(oci iam availability-domain list -c "$C" | jq -r '.data[0].name') || die "Não achei o availability domain."
log "📍 Availability domain: $AD"

# ---------- Rede ----------
# Reaproveita uma sub-rede pública existente; senão cria VCN + gateway + sub-rede.
SUBNET=$(oci network subnet list -c "$C" --all 2>/dev/null \
  | jq -r '[.data[]? | select(."prohibit-public-ip-on-vnic"==false and ."lifecycle-state"=="AVAILABLE")][0].id // empty')

if [[ -z "$SUBNET" ]]; then
  log "🌐 Criando rede (VCN, internet gateway e sub-rede pública)..."
  dns_label=$(echo "rede${VM_NAME//[^a-z0-9]/}" | cut -c1-15) # regra da OCI: letras/números, até 15
  VCN=$(oci network vcn create -c "$C" --cidr-blocks '["10.0.0.0/16"]' --display-name "rede-${VM_NAME}" \
        --dns-label "$dns_label" --wait-for-state AVAILABLE | jq -r '.data.id') || die "Falha ao criar VCN."
  IGW=$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" --is-enabled true --display-name "internet" \
        --wait-for-state AVAILABLE | jq -r '.data.id') || die "Falha ao criar internet gateway."
  RT=$(oci network vcn get --vcn-id "$VCN" | jq -r '.data."default-route-table-id"')
  oci network route-table update --rt-id "$RT" --force --wait-for-state AVAILABLE \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null \
    || die "Falha ao configurar rota pra internet."
  SL=$(oci network vcn get --vcn-id "$VCN" | jq -r '.data."default-security-list-id"')
  SUBNET=$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block "10.0.0.0/24" --display-name "subnet-publica" \
           --dns-label "publica" --route-table-id "$RT" --security-list-ids "[\"$SL\"]" \
           --wait-for-state AVAILABLE | jq -r '.data.id') || die "Falha ao criar sub-rede."
  log "🌐 Rede criada."
else
  log "🌐 Reaproveitando sub-rede pública existente."
fi

# Libera 80 e 443 (HTTPS do painel) na security list da sub-rede, mantendo as regras atuais.
for SL in $(oci network subnet get --subnet-id "$SUBNET" | jq -r '.data."security-list-ids"[]'); do
  oci network security-list get --security-list-id "$SL" | jq '.data."ingress-security-rules"' > /tmp/ingress.json
  jq '. as $r
      | reduce (80, 443) as $p ($r;
          if any(.[]; .protocol=="6" and .source=="0.0.0.0/0" and (."tcp-options"."destination-port-range".min // -1)==$p)
          then . else . + [{"protocol":"6","source":"0.0.0.0/0","isStateless":false,
                            "tcpOptions":{"destinationPortRange":{"min":$p,"max":$p}}}] end)' \
     /tmp/ingress.json > /tmp/ingress-new.json
  # A API espera camelCase; as regras lidas vêm em kebab-case, então convertemos as chaves.
  jq 'walk(if type=="object" then with_entries(.key |= gsub("-(?<c>[a-z])"; .c|ascii_upcase)) else . end)
      | del(.. | nulls)' \
     /tmp/ingress-new.json > /tmp/ingress-final.json
  oci network security-list update --security-list-id "$SL" --force \
    --ingress-security-rules file:///tmp/ingress-final.json >/dev/null \
    && log "🔓 Portas 80 e 443 liberadas." || log "⚠️  Não consegui liberar 80/443 — faça pelo console depois."
done

# ---------- Imagem: Ubuntu 24.04 ARM, versão mais recente, sem "Minimal" ----------
IMG=$(oci compute image list -c "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
      --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --all \
      | jq -r '[.data[] | select(."display-name" | test("Minimal") | not)][0].id // empty')
[[ -n "$IMG" ]] || die "Não achei imagem Ubuntu 24.04 pra $SHAPE."
log "💿 Imagem Ubuntu 24.04 encontrada."

# ---------- Tenta criar até conseguir ----------
attempt=0
while true; do
  attempt=$((attempt + 1))
  out=$(oci compute instance launch -c "$C" --availability-domain "$AD" --display-name "$VM_NAME" \
        --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
        --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true \
        --ssh-authorized-keys-file "$KEY.pub" 2>&1)

  if id=$(jq -er '.data.id' <<<"$out" 2>/dev/null); then
    log "🎉 VM criada na tentativa $attempt! Aguardando ligar..."
    oci compute instance get --instance-id "$id" --wait-for-state RUNNING >/dev/null
    ip=$(oci compute instance list-vnics --instance-id "$id" | jq -r '.data[0]."public-ip"')
    log "✅ VM \"$VM_NAME\" rodando. IP público: $ip"
    log "👉 Pra entrar:  ssh -i $KEY ubuntu@$ip"
    exit 0
  fi

  if grep -qiE "capacity" <<<"$out"; then
    log "⏳ Tentativa $attempt: sem vaga na Oracle. Tento de novo em ${RETRY_SECONDS}s."
    sleep "$RETRY_SECONDS"
  elif grep -qiE "TooManyRequests|429" <<<"$out"; then
    log "⏳ Tentativa $attempt: muitas tentativas seguidas. Esperando 5 min."
    sleep 300
  else
    log "❌ Erro diferente de falta de vaga — parei pra você conferir:"
    echo "$out" | tail -20
    exit 1
  fi
done
