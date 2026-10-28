/* Painel do Thiago: aplicativo de uma página. Fala com /admin/api/*; nada recarrega a página. */
(function () {
  'use strict';

  // ---------- utilidades ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function curta(s) { var d = parse(s); return pad(d.getDate()) + ' ' + MES[d.getMonth()]; }
  function comSemana(s) { var d = parse(s); return SEM[d.getDay()] + ', ' + curta(s); }
  function primeiroNome(n) { return n ? String(n).trim().split(/\s+/)[0] : ''; }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  // ---------- estado ----------
  var S = { casas: [], reservas: [], hoje: iso(new Date()), holdMinutos: 120, pixAutomatico: false };
  var deslocamento = 0;                 // diferença entre o relógio do servidor e o do aparelho
  var aba = 'pedidos';
  var casaSel = null;
  var mesCal = null;
  var carregou = false;
  function agora() { return Date.now() + deslocamento; }

  // ---------- rede ----------
  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    return fetch('/admin/api' + caminho, {
      method: opcoes.metodo || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Painel': '1' },
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (r) {
      if (r.status === 401) { location.replace('/admin/login'); throw new Error('sessao'); }
      return r.json().then(function (j) { j._status = r.status; return j; });
    });
  }

  function carregar(manual) {
    var bt = $('#atualizar');
    if (manual) bt.classList.add('girando');
    return api('/estado').then(function (e) {
      S = e; deslocamento = e.agora - Date.now(); carregou = true;
      if (!casaSel || !S.casas.some(function (c) { return c.codigo === casaSel; })) casaSel = S.casas[0] && S.casas[0].codigo;
      $('#offline').hidden = true;
      desenhar();
    }).catch(function (err) {
      if (err && err.message === 'sessao') return;
      $('#offline').hidden = false;
    }).then(function () { bt.classList.remove('girando'); });
  }

  // ---------- avisos e janelas ----------
  function aviso(texto, tipo) {
    var t = document.createElement('div');
    t.className = 'toast ' + (tipo || 'ok'); t.textContent = texto;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('some'); }, 3600);
    setTimeout(function () { t.remove(); }, 4100);
  }
  var folhaAberta = null;
  function abrirFolha(html, aoAbrir) {
    // Cada janela começa de um elemento novo: assim os cliques da janela anterior não ficam acumulados
    var antigo = $('#folha'), f = antigo.cloneNode(false);
    antigo.parentNode.replaceChild(f, antigo);
    f.innerHTML = '<div class="alca"></div>' + html;
    f.hidden = false; $('#fundo').hidden = false;
    document.body.style.overflow = 'hidden';
    folhaAberta = f;
    var primeiro = $('button, input, select', f); if (primeiro && !aoAbrir) primeiro.blur();
    if (aoAbrir) aoAbrir(f);
  }
  function fecharFolha() {
    $('#folha').hidden = true; $('#fundo').hidden = true; $('#folha').innerHTML = '';
    document.body.style.overflow = ''; folhaAberta = null;
  }
  $('#fundo').addEventListener('click', fecharFolha);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && folhaAberta) fecharFolha(); });

  function perguntar(o) {
    return new Promise(function (resolve) {
      abrirFolha('<h3>' + esc(o.titulo) + '</h3><p>' + esc(o.texto) + '</p>' +
        '<div class="acoes"><button class="btn" data-r="0">' + esc(o.voltar || 'Voltar') + '</button>' +
        '<button class="btn ' + (o.perigo ? 'perigo' : 'primario') + '" data-r="1">' + esc(o.botao) + '</button></div>',
        function (f) {
          f.addEventListener('click', function (e) {
            var b = e.target.closest('[data-r]'); if (!b) return;
            fecharFolha(); resolve(b.dataset.r === '1');
          });
        });
      $('#fundo').onclick = function () { fecharFolha(); resolve(false); };
    });
  }

  // ---------- regras de dados ----------
  function ativas() { return S.reservas.filter(function (r) { return r.status === 'pending' || r.status === 'confirmed'; }); }
  function noiteOcupada(casa, d, ignorar) {
    return ativas().some(function (r) { return r.casa === casa && r.entrada <= d && d < r.saida && r.id !== ignorar; });
  }
  function msgCliente(r) {
    var nome = primeiroNome(r.nome);
    return 'Olá' + (nome ? ', ' + nome : '') + '! Aqui é o Thiago, da Thiago Veras Empreendimentos. Sobre o seu pedido de reserva da ' +
      r.casaNome + ' (' + curta(r.entrada) + ' a ' + curta(r.saida) + '): ';
  }
  function linkZap(r) { return r.whatsapp ? 'https://wa.me/' + r.whatsapp + '?text=' + encodeURIComponent(msgCliente(r)) : null; }
  var ICONE_ZAP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';

  function restante(ms) {
    if (ms <= 0) return 'acabou';
    var min = Math.ceil(ms / 60000);
    if (min >= 60) return Math.floor(min / 60) + 'h' + pad(min % 60);
    return min + ' min';
  }

  // ---------- Pedidos ----------
  function cartaoPendente(r) {
    var zap = linkZap(r);
    var total = (S.holdMinutos || 120) * 60000;
    return '<article class="cartao pend" data-id="' + r.id + '">' +
      '<div class="linha1"><span class="selo pend">Aguardando pagamento</span><span class="num">#' + r.id + '</span></div>' +
      '<h3>' + esc(r.casaNome) + '</h3>' +
      '<p class="datas"><b>' + esc(comSemana(r.entrada)) + '</b> → <b>' + esc(comSemana(r.saida)) + '</b> <span>· ' + plural(r.diarias, 'diária', 'diárias') + '</span></p>' +
      '<p class="quem"><strong>' + esc(r.nome || 'Cliente sem nome') + '</strong>' +
        (r.pessoas ? '<span class="mut">' + plural(r.pessoas, 'pessoa', 'pessoas') + '</span>' : '') + '</p>' +
      (zap ? '' : '<p class="dica">Sem WhatsApp informado: o cliente vai chamar você pela conversa que chegou no seu WhatsApp.</p>') +
      (r.obs ? '<p class="obs">' + esc(r.obs) + '</p>' : '') +
      '<div class="tempo" data-exp="' + (r.expiraEm || 0) + '" data-total="' + total + '"><div class="txt"><span>Datas seguras por mais</span><b></b></div><div class="trilho"><i></i></div></div>' +
      '<div class="acoes">' +
        '<button class="btn verde" data-act="confirmar" data-id="' + r.id + '">✓ Confirmar pagamento</button>' +
        (zap ? '<a class="btn zap" href="' + zap + '" target="_blank" rel="noopener">' + ICONE_ZAP + ' Conversar</a>' : '') +
        '<button class="btn" data-act="mais" data-id="' + r.id + '">+1 hora</button>' +
        '<button class="btn perigo" data-act="cancelar" data-id="' + r.id + '">Cancelar</button>' +
      '</div></article>';
  }

  function itemLinha(r, tipo) {
    var d = parse(r.entrada);
    var zap = linkZap(r);
    var quem = tipo === 'bloq' ? (r.obs || 'Bloqueio') : (r.nome || 'Cliente sem nome');
    var sub = r.casaNome + ' · ' + curta(r.entrada) + ' → ' + curta(r.saida) + ' · ' + plural(r.diarias, 'diária', 'diárias');
    var acao = '';
    if (tipo === 'bloq') acao = '<button class="btn mini" data-act="cancelar" data-id="' + r.id + '">Liberar</button>';
    else if (tipo === 'conf') acao = (zap ? '<a class="btn mini zap" href="' + zap + '" target="_blank" rel="noopener" aria-label="Conversar">' + ICONE_ZAP + '</a>' : '') +
      '<button class="btn mini perigo" data-act="cancelar" data-id="' + r.id + '">Cancelar</button>';
    else if (r.status === 'expired') acao = '<button class="btn mini" data-act="reativar" data-id="' + r.id + '">Reativar</button>';
    var rotulo = r.status === 'expired' ? ' · expirou' : r.status === 'cancelled' ? ' · cancelada' : '';
    return '<div class="item ' + tipo + '" data-id="' + r.id + '">' +
      '<div class="data-bola"><div><b>' + pad(d.getDate()) + '</b><span>' + MES[d.getMonth()] + '</span></div></div>' +
      '<div class="meio"><strong>' + esc(quem) + '</strong><span>' + esc(sub + rotulo) + '</span></div>' + acao + '</div>';
  }

  function telaPedidos() {
    var pend = S.reservas.filter(function (r) { return r.status === 'pending'; })
      .sort(function (a, b) { return (a.expiraEm || 0) - (b.expiraEm || 0); });
    var conf = S.reservas.filter(function (r) { return r.status === 'confirmed' && r.origem !== 'manual' && r.saida >= S.hoje; })
      .sort(function (a, b) { return a.entrada < b.entrada ? -1 : 1; });
    var bloq = S.reservas.filter(function (r) { return r.status === 'confirmed' && r.origem === 'manual' && r.saida >= S.hoje; })
      .sort(function (a, b) { return a.entrada < b.entrada ? -1 : 1; });
    var hist = S.reservas.filter(function (r) { return r.status === 'expired' || r.status === 'cancelled' || (r.status === 'confirmed' && r.saida < S.hoje); })
      .sort(function (a, b) { return b.criadoEm - a.criadoEm; });

    var livres = S.casas.filter(function (c) { return !noiteOcupada(c.codigo, S.hoje); }).length;
    var proxima = conf.filter(function (r) { return r.entrada >= S.hoje; })[0];
    var h = '<section>' +
      '<div class="resumo">' +
        '<div class="tile' + (pend.length ? ' alerta' : '') + '"><small>Aguardando</small><b>' + pend.length + '</b><span>' + (pend.length === 1 ? 'pedido' : 'pedidos') + '</span></div>' +
        '<div class="tile"><small>Próxima entrada</small><b>' + (proxima ? esc(curta(proxima.entrada)) : '—') + '</b><span>' + (proxima ? esc(proxima.casaNome) : 'nenhuma ainda') + '</span></div>' +
        '<div class="tile"><small>Livres hoje</small><b>' + livres + '/' + S.casas.length + '</b><span>casas</span></div>' +
      '</div>';

    h += '<h2>Aguardando pagamento <span class="n">' + pend.length + '</span></h2>';
    h += pend.length ? '<div class="cartoes">' + pend.map(cartaoPendente).join('') + '</div>'
      : '<div class="vazio"><b>Nenhum pedido esperando.</b>Quando um cliente finalizar no site, o pedido aparece aqui e você recebe a mensagem no WhatsApp.</div>';

    h += '<h2>Reservas confirmadas <span class="n">' + conf.length + '</span></h2>';
    h += conf.length ? '<div class="lista">' + conf.map(function (r) { return itemLinha(r, 'conf'); }).join('') + '</div>'
      : '<div class="vazio">Nenhuma reserva confirmada pela frente.</div>';

    if (bloq.length) h += '<h2>Datas bloqueadas <span class="n">' + bloq.length + '</span></h2><div class="lista">' + bloq.map(function (r) { return itemLinha(r, 'bloq'); }).join('') + '</div>';

    if (hist.length) h += '<details class="hist"><summary>Histórico <span class="n" style="font-size:.78rem;font-weight:700;color:var(--muted)">' + hist.length + '</span></summary><div class="lista" style="margin-top:10px">' +
      hist.slice(0, 20).map(function (r) { return itemLinha(r, 'hist-i'); }).join('') + '</div></details>';
    return h + '</section>';
  }

  // ---------- Calendário ----------
  // O calendário abre no mês da próxima reserva da casa (ou no mês atual, se não houver nenhuma)
  function mesInicial(casa) {
    var hj = parse(S.hoje);
    var prox = ativas().filter(function (r) { return r.casa === casa && r.saida > S.hoje; })
      .sort(function (a, b) { return a.entrada < b.entrada ? -1 : 1; })[0];
    var base = prox && prox.entrada > S.hoje ? parse(prox.entrada) : hj;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }

  function telaCalendario() {
    if (!mesCal) mesCal = mesInicial(casaSel);
    var chips = S.casas.map(function (c) {
      return '<button type="button" class="chip" data-casa="' + esc(c.codigo) + '" aria-pressed="' + (c.codigo === casaSel) + '">' + esc(c.nome) + '</button>';
    }).join('');
    var h = '<section><div class="chips" role="group" aria-label="Casa">' + chips + '</div>' +
      '<div class="cal"><div class="cal-topo"><button class="cal-nav" data-nav="-1" aria-label="Mês anterior">‹</button>' +
      '<strong>' + MESES[mesCal.getMonth()] + ' de ' + mesCal.getFullYear() + '</strong>' +
      '<button class="cal-nav" data-nav="1" aria-label="Próximo mês">›</button></div>' +
      '<div class="cal-sem"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div><div class="cal-grade">';
    var n = new Date(mesCal.getFullYear(), mesCal.getMonth() + 1, 0).getDate(), lead = mesCal.getDay(), ocup = 0;
    for (var v = 0; v < lead; v++) h += '<span class="dia vz"></span>';
    for (var d = 1; d <= n; d++) {
      var dia = iso(new Date(mesCal.getFullYear(), mesCal.getMonth(), d));
      var r = ativas().filter(function (x) { return x.casa === casaSel && x.entrada <= dia && dia < x.saida; })[0];
      var cls = 'dia' + (dia < S.hoje ? ' passado' : '') + (dia === S.hoje ? ' hoje' : '');
      if (r) {
        ocup++;
        cls += r.origem === 'manual' ? ' bloq' : r.status === 'pending' ? ' pend' : ' conf';
        if (dia === r.entrada) cls += ' ini';
        var amanha = iso(new Date(mesCal.getFullYear(), mesCal.getMonth(), d + 1));
        if (amanha === r.saida) cls += ' fim';
      }
      h += '<button type="button" class="' + cls + '" data-dia="' + dia + '" aria-label="' + d + ' de ' + MESES[mesCal.getMonth()].toLowerCase() + (r ? ', ocupado' : ', livre') + '"><span>' + d + '</span></button>';
    }
    h += '</div><div class="leg"><span><i></i>Livre</span><span><i class="p"></i>Aguardando</span><span><i class="c"></i>Confirmada</span><span><i class="b"></i>Bloqueada</span></div>' +
      '<p class="ocup-txt">' + ocup + ' de ' + n + ' noites ocupadas neste mês</p></div></section>';
    return h;
  }

  function folhaDia(dia) {
    var lista = ativas().filter(function (x) { return x.casa === casaSel && x.entrada <= dia && dia < x.saida; });
    var casa = S.casas.filter(function (c) { return c.codigo === casaSel; })[0];
    if (!lista.length) {
      if (dia < S.hoje) return;
      abrirFolha('<h3>' + esc(comSemana(dia)) + '</h3><p>' + esc(casa.nome) + ' está livre nesta noite.</p>' +
        '<div class="acoes"><button class="btn" data-fechar>Fechar</button><button class="btn primario" data-bloquear="' + dia + '">Bloquear a partir daqui</button></div>',
        function (f) {
          f.addEventListener('click', function (e) {
            if (e.target.closest('[data-fechar]')) fecharFolha();
            var b = e.target.closest('[data-bloquear]');
            if (b) { fecharFolha(); aba = 'bloquear'; preSelecao = { casa: casaSel, entrada: b.dataset.bloquear }; desenhar(); }
          });
        });
      return;
    }
    abrirFolha('<h3>' + esc(comSemana(dia)) + '</h3><p>' + esc(casa.nome) + '</p><div class="lista" style="margin-top:12px">' +
      lista.map(function (r) { return itemLinha(r, r.origem === 'manual' ? 'bloq' : r.status === 'pending' ? 'pend' : 'conf'); }).join('') +
      '</div><div class="acoes"><button class="btn" data-fechar>Fechar</button></div>', function (f) {
      f.addEventListener('click', function (e) {
        if (e.target.closest('[data-fechar]')) { fecharFolha(); return; }
        var b = e.target.closest('[data-act]'); if (b) { fecharFolha(); executar(b.dataset.act, +b.dataset.id); }
      });
    });
  }

  // ---------- Bloquear ----------
  var preSelecao = null;
  var bloqueio = { casa: null, entrada: '', saida: '', mes: null };
  function telaBloquear() {
    if (preSelecao) { bloqueio.casa = preSelecao.casa; bloqueio.entrada = preSelecao.entrada; bloqueio.saida = ''; var p = parse(preSelecao.entrada); bloqueio.mes = new Date(p.getFullYear(), p.getMonth(), 1); preSelecao = null; }
    if (!bloqueio.casa) bloqueio.casa = S.casas[0] && S.casas[0].codigo;
    if (!bloqueio.mes) { var hj = parse(S.hoje); bloqueio.mes = new Date(hj.getFullYear(), hj.getMonth(), 1); }
    var m = bloqueio.mes;
    var h = '<section><h2 style="margin-top:6px">Bloquear datas</h2>' +
      '<p class="dica" style="margin:-4px 0 6px">Use para reservas feitas por telefone, Airbnb ou quando a casa estiver em uso. O site passa a mostrar essas datas como ocupadas.</p>' +
      '<label class="campo">Casa<select id="b-casa">' + S.casas.map(function (c) { return '<option value="' + esc(c.codigo) + '"' + (c.codigo === bloqueio.casa ? ' selected' : '') + '>' + esc(c.nome) + '</option>'; }).join('') + '</select></label>' +
      '<div class="sel" style="margin-top:14px"><div class="cal-topo"><button class="cal-nav" data-bn="-1" aria-label="Mês anterior">‹</button><strong>' + MESES[m.getMonth()] + ' de ' + m.getFullYear() + '</strong><button class="cal-nav" data-bn="1" aria-label="Próximo mês">›</button></div>' +
      '<div class="cal-sem"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div><div class="cal-grade" id="b-grade">';
    var n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (var v = 0; v < m.getDay(); v++) h += '<span class="dia vz"></span>';
    for (var d = 1; d <= n; d++) {
      var dia = iso(new Date(m.getFullYear(), m.getMonth(), d));
      var cls = 'dia', desligado = dia < S.hoje;
      var ocupado = noiteOcupada(bloqueio.casa, dia);
      if (ocupado) { cls += ' ocupado'; desligado = true; }
      if (dia < S.hoje) cls += ' passado';
      if (dia === S.hoje) cls += ' hoje';
      var ate = bloqueio.saida || bloqueio.entrada;
      if (bloqueio.entrada && dia >= bloqueio.entrada && dia <= ate) {
        cls += ' escolha'; if (dia === bloqueio.entrada) cls += ' ini'; if (dia === ate) cls += ' fim';
      }
      h += '<button type="button" class="' + cls + '" data-bd="' + dia + '"' + (desligado ? ' disabled' : '') + '><span>' + d + '</span></button>';
    }
    var txt = '', erro = false;
    if (!bloqueio.entrada) txt = 'Toque no primeiro dia.';
    else if (!bloqueio.saida) txt = 'De ' + curta(bloqueio.entrada) + '. Agora toque no último dia a bloquear.';
    else txt = curta(bloqueio.entrada) + ' a ' + curta(bloqueio.saida) + ' (' + plural(noitesBloqueio(), 'noite', 'noites') + ')';
    h += '</div><p class="escolhido' + (erro ? ' erro' : '') + '" id="b-txt">' + esc(txt) + '</p></div>' +
      '<label class="campo">Observação (opcional)<input id="b-obs" maxlength="200" placeholder="Ex.: reserva pelo Airbnb, uso do proprietário"></label>' +
      '<div class="sugestoes">' + ['Uso próprio', 'Airbnb', 'Reserva por telefone', 'Manutenção'].map(function (t) { return '<button type="button" data-sug="' + t + '">' + t + '</button>'; }).join('') + '</div>' +
      '<div class="acoes"><button class="btn primario grande" id="b-ok"' + (bloqueio.entrada && bloqueio.saida ? '' : ' disabled') + '>Bloquear estas datas</button></div></section>';
    return h;
  }
  // o último dia escolhido é uma noite ocupada; a saída gravada é o dia seguinte
  function noitesBloqueio() { return Math.round((parse(bloqueio.saida) - parse(bloqueio.entrada)) / 86400000) + 1; }
  function diaSeguinte(s) { var d = parse(s); d.setDate(d.getDate() + 1); return iso(d); }

  function clicouDiaBloqueio(dia) {
    if (!bloqueio.entrada || bloqueio.saida) { bloqueio.entrada = dia; bloqueio.saida = ''; return; }
    if (dia < bloqueio.entrada) { bloqueio.entrada = dia; return; }
    // não deixa o período atravessar uma noite já ocupada
    for (var d = bloqueio.entrada; d <= dia; d = diaSeguinte(d)) {
      if (noiteOcupada(bloqueio.casa, d)) { bloqueio.entrada = dia; bloqueio.saida = ''; aviso('Esse período cruza uma reserva. Escolhi só a nova data de início.', 'erro'); return; }
    }
    bloqueio.saida = dia;
  }

  // ---------- ações ----------
  function executar(acao, id) {
    var r = S.reservas.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var botoes = document.querySelectorAll('[data-id="' + id + '"] [data-act]');
    function ocupado(sim) { botoes.forEach(function (b) { b.disabled = sim; if (sim && b.dataset.act === acao) b.classList.add('carregando'); else b.classList.remove('carregando'); }); }
    var passo;
    if (acao === 'confirmar') {
      passo = perguntar({ titulo: 'Confirmar o pagamento?', texto: 'Só confirme depois de ver o Pix na conta do banco. As datas de ' + r.casaNome + ' (' + curta(r.entrada) + ' a ' + curta(r.saida) + ') ficam reservadas.', botao: 'Sim, o Pix caiu' })
        .then(function (ok) { return ok && api('/reservas/' + id + '/confirmar', { metodo: 'POST' }); });
    } else if (acao === 'cancelar') {
      var ehBloqueio = r.origem === 'manual';
      passo = perguntar({ titulo: ehBloqueio ? 'Liberar estas datas?' : 'Cancelar este pedido?', texto: 'As datas de ' + r.casaNome + ' (' + curta(r.entrada) + ' a ' + curta(r.saida) + ') voltam a ficar livres no site.' + (r.pago ? ' Esta reserva tinha Pix pago: faça a devolução pelo app do banco.' : ''), botao: ehBloqueio ? 'Liberar datas' : 'Cancelar pedido', voltar: 'Manter', perigo: true })
        .then(function (ok) { return ok && api('/reservas/' + id + '/cancelar', { metodo: 'POST' }); });
    } else if (acao === 'mais') {
      passo = Promise.resolve(api('/reservas/' + id + '/mais-tempo', { metodo: 'POST', corpo: { minutos: 60 } }));
    } else if (acao === 'reativar') {
      passo = Promise.resolve(api('/reservas/' + id + '/mais-tempo', { metodo: 'POST', corpo: { minutos: S.holdMinutos || 120 } }));
    } else return;
    passo.then(function (res) {
      if (!res) return;
      aviso(res.message, res.ok ? 'ok' : 'erro');
      return carregar();
    }).catch(function (e) { if (!e || e.message !== 'sessao') aviso('Sem conexão. Tente de novo.', 'erro'); }).then(function () { ocupado(false); });
    if (acao !== 'confirmar' && acao !== 'cancelar') ocupado(true);
  }

  function salvarBloqueio() {
    var obs = ($('#b-obs') || {}).value || '';
    var btn = $('#b-ok'); btn.disabled = true; btn.classList.add('carregando');
    api('/bloqueios', { metodo: 'POST', corpo: { casa: bloqueio.casa, entrada: bloqueio.entrada, saida: diaSeguinte(bloqueio.saida), obs: obs } })
      .then(function (res) {
        aviso(res.message, res.ok ? 'ok' : 'erro');
        if (res.ok) {
          var pe = parse(bloqueio.entrada);
          mesCal = new Date(pe.getFullYear(), pe.getMonth(), 1); // abre o calendário no mês do bloqueio
          bloqueio.entrada = ''; bloqueio.saida = ''; casaSel = bloqueio.casa; aba = 'calendario';
        }
        return carregar();
      }).catch(function () { aviso('Sem conexão. Tente de novo.', 'erro'); desenhar(); });
  }

  // ---------- desenho ----------
  function desenhar() {
    var c = $('#conteudo');
    var rolagem = window.scrollY;
    c.innerHTML = aba === 'pedidos' ? telaPedidos() : aba === 'calendario' ? telaCalendario() : telaBloquear();
    document.querySelectorAll('.abas button').forEach(function (b) { b.classList.toggle('ativa', b.dataset.aba === aba); });
    var pend = S.reservas.filter(function (r) { return r.status === 'pending'; }).length;
    var badge = $('#badge'); badge.hidden = !pend; badge.textContent = pend;
    var proximaExp = S.reservas.filter(function (r) { return r.status === 'pending'; }).length;
    $('#status').textContent = pend ? plural(pend, 'pedido aguardando', 'pedidos aguardando') : 'Tudo em dia';
    document.title = (pend ? '(' + pend + ') ' : '') + 'Painel de reservas — Thiago Veras';
    tique();
    if (aba === 'pedidos') window.scrollTo(0, rolagem);
  }

  // contagem regressiva ao vivo, sem redesenhar a tela
  function tique() {
    var venceu = false;
    document.querySelectorAll('.tempo').forEach(function (t) {
      var falta = (+t.dataset.exp) - agora(), total = +t.dataset.total || 7200000;
      var b = $('b', t), barra = $('i', t);
      b.textContent = falta <= 0 ? 'acabou' : restante(falta);
      barra.style.width = Math.max(0, Math.min(100, (falta / total) * 100)) + '%';
      t.classList.toggle('acaba', falta < 15 * 60000);
      if (falta <= 0) venceu = true;
    });
    if (venceu && !tique.espera) { tique.espera = true; setTimeout(function () { tique.espera = false; carregar(); }, 2500); }
  }

  // ---------- eventos ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t.closest('.abas [data-aba]');
    if (a) { aba = a.dataset.aba; desenhar(); window.scrollTo(0, 0); return; }
    if (t.closest('#atualizar')) { carregar(true); return; }
    if (t.closest('#menu')) { menuApp(); return; }

    var act = t.closest('#conteudo [data-act]');
    if (act) { executar(act.dataset.act, +act.dataset.id); return; }

    var chip = t.closest('[data-casa]');
    if (chip && aba === 'calendario') { casaSel = chip.dataset.casa; mesCal = null; desenhar(); return; }
    var nav = t.closest('[data-nav]');
    if (nav) { mesCal = new Date(mesCal.getFullYear(), mesCal.getMonth() + (+nav.dataset.nav), 1); desenhar(); return; }
    var dia = t.closest('#conteudo .cal [data-dia]');
    if (dia) { folhaDia(dia.dataset.dia); return; }

    var bn = t.closest('[data-bn]');
    if (bn) { bloqueio.mes = new Date(bloqueio.mes.getFullYear(), bloqueio.mes.getMonth() + (+bn.dataset.bn), 1); desenhar(); return; }
    var bd = t.closest('[data-bd]');
    if (bd && !bd.disabled) { clicouDiaBloqueio(bd.dataset.bd); desenhar(); return; }
    var sug = t.closest('[data-sug]');
    if (sug) { $('#b-obs').value = sug.dataset.sug; return; }
    if (t.closest('#b-ok')) { salvarBloqueio(); return; }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'b-casa') { bloqueio.casa = e.target.value; bloqueio.entrada = ''; bloqueio.saida = ''; desenhar(); }
  });

  function menuApp() {
    abrirFolha('<h3>Painel de reservas</h3><p>Thiago Veras Empreendimentos</p>' +
      '<div class="lista" style="margin-top:12px">' +
      '<a class="item" href="https://thiagoverasempreendimentos.github.io" target="_blank" rel="noopener" style="text-decoration:none"><div class="meio"><strong>Abrir o site</strong><span>Ver como o cliente vê</span></div></a>' +
      '<button class="item" data-senha style="border:0;width:100%;text-align:left;cursor:pointer"><div class="meio"><strong>Trocar senha</strong><span>Escolha uma senha nova para o painel</span></div></button>' +
      '<button class="item" data-todos style="border:0;width:100%;text-align:left;cursor:pointer"><div class="meio"><strong>Sair de todos os aparelhos</strong><span>Use se perder ou emprestar o celular</span></div></button>' +
      '<div class="item"><div class="meio"><strong>Instalar no celular</strong><span>No Chrome: menu ⋮ → Adicionar à tela inicial. No iPhone: Compartilhar → Adicionar à Tela de Início.</span></div></div>' +
      '</div><div class="acoes"><button class="btn" data-fechar>Fechar</button><button class="btn perigo" data-sair>Sair</button></div>',
      function (f) {
        f.addEventListener('click', function (e) {
          if (e.target.closest('[data-fechar]')) fecharFolha();
          if (e.target.closest('[data-senha]')) { telaTrocarSenha(); return; }
          if (e.target.closest('[data-todos]')) { sairDeTodos(); return; }
          if (e.target.closest('[data-sair]')) {
            fetch('/admin/logout', { method: 'POST', headers: { 'X-Painel': '1' }, credentials: 'same-origin' }).then(function () { location.replace('/admin/login'); });
          }
        });
      });
  }

  function sairDeTodos() {
    perguntar({ titulo: 'Sair de todos os aparelhos?', texto: 'Todos os outros celulares e computadores precisam entrar de novo com a senha. Este aparelho continua conectado.', botao: 'Desconectar todos', perigo: true })
      .then(function (ok) { return ok && api('/sair-todos', { metodo: 'POST' }); })
      .then(function (res) { if (res) aviso(res.message, res.ok ? 'ok' : 'erro'); })
      .catch(function (e) { if (!e || e.message !== 'sessao') aviso('Sem conexão. Tente de novo.', 'erro'); });
  }

  function telaTrocarSenha() {
    abrirFolha('<h3>Trocar senha</h3><p>Escolha uma senha que só você e quem usa o painel conheçam.</p>' +
      '<form id="f-senha" novalidate>' +
      '<label class="campo-senha">Senha atual<input id="s-atual" type="password" autocomplete="current-password" required></label>' +
      '<label class="campo-senha">Senha nova<input id="s-nova" type="password" autocomplete="new-password" required></label>' +
      '<div class="forca" id="s-barra" data-nivel="0" aria-hidden="true" style="margin-top:8px"><i></i><i></i><i></i><i></i></div><p class="forca-txt" id="s-rotulo" aria-live="polite"></p>' +
      '<label class="campo-senha">Repita a senha nova<input id="s-rep" type="password" autocomplete="new-password" required></label>' +
      '<p class="dica" style="margin-top:10px">Mínimo de 10 caracteres, sem espaços. Uma frase juntando 3 palavras e um número funciona bem.</p>' +
      '<p class="erro" id="s-erro" role="alert" hidden style="margin-top:10px"></p>' +
      '<div class="acoes"><button type="button" class="btn" data-ver>Mostrar senhas</button><button type="button" class="btn" data-fechar>Cancelar</button><button type="submit" class="btn primario" id="s-ok" style="flex:1 1 100%">Salvar senha nova</button></div></form>',
      function (f) {
        var atual = $('#s-atual', f), nova = $('#s-nova', f), rep = $('#s-rep', f), erro = $('#s-erro', f), ok = $('#s-ok', f);
        atual.focus();
        nova.addEventListener('input', function () { window.pintarForca($('#s-barra', f), $('#s-rotulo', f), nova.value); });
        f.addEventListener('click', function (e) {
          if (e.target.closest('[data-fechar]')) fecharFolha();
          if (e.target.closest('[data-ver]')) {
            var t = atual.type === 'password' ? 'text' : 'password';
            atual.type = nova.type = rep.type = t;
            e.target.closest('[data-ver]').textContent = t === 'text' ? 'Esconder senhas' : 'Mostrar senhas';
          }
        });
        $('#f-senha', f).addEventListener('submit', function (e) {
          e.preventDefault();
          function falha(t) { erro.textContent = t; erro.hidden = false; ok.disabled = false; ok.classList.remove('carregando'); }
          erro.hidden = true;
          if (!atual.value) return falha('Digite a senha atual.');
          if (nova.value !== rep.value) return falha('As duas senhas novas não são iguais.');
          ok.disabled = true; ok.classList.add('carregando');
          api('/senha', { metodo: 'POST', corpo: { atual: atual.value, nova: nova.value } }).then(function (res) {
            if (res.ok) { fecharFolha(); aviso(res.message, 'ok'); return; }
            falha(res.message || 'Não foi possível trocar a senha.');
          }).catch(function (err) { if (!err || err.message !== 'sessao') falha('Sem conexão. Tente de novo.'); });
        });
      });
  }

  // ---------- partida ----------
  carregar();
  setInterval(tique, 1000);
  setInterval(function () { if (document.visibilityState === 'visible' && !folhaAberta) carregar(); }, 15000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') carregar(); });
  window.addEventListener('online', function () { carregar(); });
})();
