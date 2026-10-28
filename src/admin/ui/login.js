(function () {
  var f = document.getElementById('f'), erro = document.getElementById('erro'), btn = document.getElementById('entrar');
  var s = document.getElementById('s');
  document.getElementById('ver').addEventListener('click', function () {
    s.type = s.type === 'password' ? 'text' : 'password';
  });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    erro.hidden = true; btn.disabled = true; btn.textContent = 'Entrando…';
    fetch('/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Painel': '1' },
      body: JSON.stringify({ usuario: document.getElementById('u').value, senha: s.value })
    }).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.j.ok) { location.replace('/admin/'); return; }
        erro.textContent = x.j.message || 'Não foi possível entrar.'; erro.hidden = false;
        btn.disabled = false; btn.textContent = 'Entrar'; s.focus(); s.select();
      })
      .catch(function () {
        erro.textContent = 'Sem conexão. Confira a internet e tente de novo.'; erro.hidden = false;
        btn.disabled = false; btn.textContent = 'Entrar';
      });
  });
})();
