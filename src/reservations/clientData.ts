/**
 * Extrai nome e CPF de uma mensagem livre do cliente.
 * Exemplos aceitos:
 *   "João Silva, 52998224725"
 *   "João Silva - 529.982.247-25"
 *   "meu nome é João Silva e cpf 52998224725"
 */

export type ClientData = { name: string; cpf: string };
export type ClientDataResult = ClientData | 'invalid_cpf' | null;

export function parseClientData(text: string): ClientDataResult {
  const digits = (text.match(/\d/g) ?? []).join('');
  const cpfMatch = text.match(/(\d{3}[\.\s-]?\d{3}[\.\s-]?\d{3}[\.\s-]?\d{2})/);
  const cpf = cpfMatch ? cpfMatch[1]!.replace(/\D/g, '') : (digits.length === 11 ? digits : null);
  if (!cpf || cpf.length !== 11) return null;

  let name = text;
  if (cpfMatch) name = name.replace(cpfMatch[1]!, ' ');
  else name = name.replace(cpf, ' ');
  name = name
    .replace(/[\d]/g, ' ')
    .replace(/[,:\-\.;]/g, ' ')
    .replace(/\b(cpf|nome|meu|é|eh|e|no|do|da|de)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (name.length < 3 || name.split(' ').length < 2) return null;
  if (!isValidCpf(cpf)) return 'invalid_cpf';

  return { name: titleCase(name), cpf };
}

/** Dígitos verificadores do CPF (algoritmo da Receita Federal). */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const nums = cpf.split('').map(Number);
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += nums[i]! * (len + 1 - i);
    const check = (sum * 10) % 11 % 10;
    if (check !== nums[len]) return false;
  }
  return true;
}

function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map(w =>
    w.length ? w[0]!.toUpperCase() + w.slice(1) : w,
  ).join(' ');
}

export function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
