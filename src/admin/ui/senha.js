/* Páginas "Esqueci minha senha" e "Criar nova senha". */
(function () {
  var pagina = document.body.dataset.pagina;
  function $(id) { return document.getElementById(id); }
  function aviso(el, texto, ok) { el.textContent = texto; el.hidden = !texto; el.className = ok ? 'ok-msg' : 'erro'; }
  function enviar(url, corpo) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' }, body: JSON.stringify(corpo), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }

  if (pagina === 'esqueci') {
    var f = $('f'), msg = $('msg'), btn = $('enviar');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { aviso(msg, 'Digite um e-mail válido.', false); return; }
      btn.disabled = true; btn.textContent = 'Enviando…'; aviso(msg, '', false);
      enviar('/admin/esqueci', { email: email }).then(function (j) {
        if (j.ok) { f.hidden = true; $('feito').hidden = false; $('feito-txt').textContent = j.message; return; }
        aviso(msg, j.message || 'Não foi possível enviar agora.', false); btn.disabled = false; btn.textContent = 'Enviar link';
      }).catch(function () { aviso(msg, 'Sem conexão. Tente de novo.', false); btn.disabled = false; btn.textContent = 'Enviar link'; });
    });
  }

  if (pagina === 'redefinir') {
    var token = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    history.replaceState(null, '', location.pathname);   // tira o código da barra de endereço
    var f2 = $('f'), msg2 = $('msg'), btn2 = $('salvar'), n1 = $('n1'), n2 = $('n2'), verif = $('verificando');
    function invalido(texto) { verif.hidden = true; f2.hidden = true; $('invalido').hidden = false; $('invalido-txt').textContent = texto || 'Este link não é mais válido.'; }
    if (!token) { invalido('Falta o código do link. Abra o link que chegou no seu e-mail.'); }
    else enviar('/admin/redefinir/verificar', { token: token }).then(function (j) {
      if (j.ok) { verif.hidden = true; f2.hidden = false; n1.focus(); } else invalido(j.message);
    }).catch(function () { invalido('Sem conexão. Recarregue a página e tente de novo.'); });

    $('ver').addEventListener('click', function () { var t = n1.type === 'password' ? 'text' : 'password'; n1.type = t; n2.type = t; });
    n1.addEventListener('input', function () { window.pintarForca($('barra'), $('rotulo'), n1.value); });
    f2.addEventListener('submit', function (e) {
      e.preventDefault();
      if (n1.value !== n2.value) { aviso(msg2, 'As duas senhas não são iguais.', false); return; }
      btn2.disabled = true; btn2.textContent = 'Salvando…'; aviso(msg2, '', false);
      enviar('/admin/redefinir', { token: token, nova: n1.value }).then(function (j) {
        if (j.ok) { f2.hidden = true; $('pronto').hidden = false; return; }
        if (j._status === 410) { invalido(j.message); return; }
        aviso(msg2, j.message || 'Não foi possível salvar.', false); btn2.disabled = false; btn2.textContent = 'Salvar nova senha';
      }).catch(function () { aviso(msg2, 'Sem conexão. Tente de novo.', false); btn2.disabled = false; btn2.textContent = 'Salvar nova senha'; });
    });
  }
})();
