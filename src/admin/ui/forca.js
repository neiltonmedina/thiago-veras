/* Medidor de força da senha (só orientação: quem decide é o servidor). */
(function () {
  window.forcaSenha = function (s) {
    if (!s) return { nivel: 0, texto: '' };
    var classes = (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/\d/.test(s) ? 1 : 0) + (/[^A-Za-z0-9]/.test(s) ? 1 : 0);
    var unicos = new Set(s.split('')).size;
    if (s.length < 10 || /^\d+$/.test(s) || unicos < 4) return { nivel: 1, texto: s.length < 10 ? 'Muito curta (mínimo 10)' : 'Fraca' };
    if (s.length >= 16 && classes >= 3) return { nivel: 4, texto: 'Muito forte' };
    if (s.length >= 13 && classes >= 3) return { nivel: 3, texto: 'Forte' };
    if (classes >= 2) return { nivel: 2, texto: 'Boa' };
    return { nivel: 1, texto: 'Fraca' };
  };
  window.pintarForca = function (barra, rotulo, s) {
    var f = window.forcaSenha(s);
    barra.dataset.nivel = f.nivel; rotulo.textContent = f.texto;
  };
})();
