/**
 * Extrai nome e CPF de uma mensagem livre do cliente.
 * Exemplos aceitos:
 *   "João Silva, 12345678900"
 *   "João Silva - 123.456.789-00"
 *   "meu nome é João Silva e cpf 12345678900"
 *   "João da Silva Santos 12345678900"
 */

export type ClientData = { name: string; cpf: string };

export function parseClientData(text: string): ClientData | null {
  const digits = (text.match(/\d/g) ?? []).join('');
  // Tenta encontrar 11 dígitos consecutivos (com ou sem pontuação)
  const cpfMatch = text.match(/(\d{3}[\.\s-]?\d{3}[\.\s-]?\d{3}[\.\s-]?\d{2})/);
  const cpf = cpfMatch ? cpfMatch[1]!.replace(/\D/g, '') : (digits.length === 11 ? digits : null);
  if (!cpf || cpf.length !== 11) return null;

  // Nome = tudo que não é o CPF nem palavras de conector
  let name = text;
  if (cpfMatch) name = name.replace(cpfMatch[1]!, ' ');
  else name = name.replace(cpf, ' ');
  name = name
    .replace(/[\d]/g, ' ')                                    // remove dígitos avulsos
    .replace(/[,:\-\.;]/g, ' ')                               // remove pontuação separadora
    .replace(/\b(cpf|nome|meu|é|eh|e|no|do|da|de)\b/gi, ' ')  // remove conectores
    .replace(/\s+/g, ' ')
    .trim();

  if (name.length < 3 || name.split(' ').length < 2) return null;

  return { name: titleCase(name), cpf };
}

function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map(w =>
    w.length ? w[0]!.toUpperCase() + w.slice(1) : w,
  ).join(' ');
}

export function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
