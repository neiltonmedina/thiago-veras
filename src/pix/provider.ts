import https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';

export type PixCharge = {
  txid: string;
  copyPaste: string;
  /** PNG em base64, sem o prefixo data: */
  qrImageBase64: string | null;
};

export type PixChargeStatus = 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';

export type CreateChargeInput = {
  amountCents: number;
  expiresInSec: number;
  payer: { name: string; cpf: string };
  description: string;
};

export interface PixProvider {
  createCharge(input: CreateChargeInput): Promise<PixCharge>;
  getStatus(txid: string): Promise<PixChargeStatus>;
}

function reais(cents: number): string {
  return (cents / 100).toFixed(2);
}

type EfiConfig = Extract<NonNullable<typeof config.pix>, { mode: 'efi' }>;

/**
 * API Pix da Efí (ex-Gerencianet). Autenticação OAuth2 + certificado (mTLS).
 * Docs: https://dev.efipay.com.br/docs/api-pix/credenciais
 */
class EfiProvider implements PixProvider {
  private http: AxiosInstance;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private cfg: EfiConfig) {
    const httpsAgent = new https.Agent({
      pfx: readFileSync(cfg.certPath),
      passphrase: cfg.certPassword,
    });
    this.http = axios.create({
      baseURL: cfg.sandbox ? 'https://pix-h.api.efipay.com.br' : 'https://pix.api.efipay.com.br',
      httpsAgent,
      timeout: 20_000,
    });
  }

  private async authHeader(): Promise<{ Authorization: string }> {
    if (!this.token || Date.now() > this.token.expiresAt) {
      const { data } = await this.http.post(
        '/oauth/token',
        { grant_type: 'client_credentials' },
        { auth: { username: this.cfg.clientId, password: this.cfg.clientSecret } },
      );
      // Renova 1 min antes de vencer
      this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    }
    return { Authorization: `Bearer ${this.token.value}` };
  }

  async createCharge(input: CreateChargeInput): Promise<PixCharge> {
    const headers = await this.authHeader();
    const { data: cob } = await this.http.post('/v2/cob', {
      calendario: { expiracao: input.expiresInSec },
      devedor: { cpf: input.payer.cpf, nome: input.payer.name.slice(0, 200) },
      valor: { original: reais(input.amountCents) },
      chave: this.cfg.pixKey,
      solicitacaoPagador: input.description.slice(0, 140),
    }, { headers });

    const { data: qr } = await this.http.get(`/v2/loc/${cob.loc.id}/qrcode`, { headers });
    const image = typeof qr.imagemQrcode === 'string' ? qr.imagemQrcode.replace(/^data:image\/\w+;base64,/, '') : null;

    return {
      txid: cob.txid,
      copyPaste: qr.qrcode ?? cob.pixCopiaECola,
      qrImageBase64: image,
    };
  }

  async getStatus(txid: string): Promise<PixChargeStatus> {
    const headers = await this.authHeader();
    const { data } = await this.http.get(`/v2/cob/${encodeURIComponent(txid)}`, { headers });
    return data.status;
  }
}

/** Provedor falso pro `npm run simulate`. `mockPay` simula o cliente pagando. */
class MockProvider implements PixProvider {
  private statuses = new Map<string, PixChargeStatus>();

  async createCharge(input: CreateChargeInput): Promise<PixCharge> {
    const txid = 'MOCK' + randomBytes(14).toString('hex').toUpperCase();
    this.statuses.set(txid, 'ATIVA');
    return {
      txid,
      copyPaste: `00020101021226830014BR.GOV.BCB.PIX2561mock.local/${txid}5204000053039865406${reais(input.amountCents)}5802BR6304MOCK`,
      qrImageBase64: Buffer.from('mock-png').toString('base64'),
    };
  }

  async getStatus(txid: string): Promise<PixChargeStatus> {
    return this.statuses.get(txid) ?? 'REMOVIDA_PELO_PSP';
  }

  mockPay(txid: string): void {
    this.statuses.set(txid, 'CONCLUIDA');
  }
}

export const pixProvider: PixProvider | null =
  config.pix?.mode === 'efi' ? new EfiProvider(config.pix)
  : config.pix?.mode === 'mock' ? new MockProvider()
  : null;

export function mockPay(txid: string): void {
  if (!(pixProvider instanceof MockProvider)) throw new Error('mockPay só funciona em SIMULATE=1');
  pixProvider.mockPay(txid);
}
