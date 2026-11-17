/* Downloads dentro do artifact: o navegador do artifact não baixa por <a download>, então os arquivos
   passam pelo recurso de downloads do Claude (o visitante confirma cada arquivo). Os modelos 3D, que rodam
   em iframes, pedem o download por postMessage ({tipo:'coe:baixar', nome, dados}). */
(function () {
  let rec = null;
  async function salvar(nome, dados) {
    /* dentro de um modelo 3D (iframe da mesma origem), quem salva é a página principal */
    try { if (window.parent !== window && window.parent.coeBaixar) return window.parent.coeBaixar(nome, dados); } catch (e) { /* outra origem */ }
    try {
      if (!rec && window.claude && claude.use) rec = await claude.use('downloads');
      if (rec) { await rec.save({ filename: nome, data: dados }); return true; }
    } catch (e) {
      if (e && e.code === 'declined') return false;
      console.warn('download', e);
    }
    /* fora do artifact (site publicado normalmente): download comum */
    try {
      const url = URL.createObjectURL(dados instanceof Blob ? dados : new Blob([dados]));
      const a = document.createElement('a');
      a.href = url; a.download = nome; a.dataset.coeNativo = '1';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { return false; }
  }
  window.coeBaixar = salvar;
  /* arquivos que o artifact não serve (.xlsx) vêm em base64 num .js ao lado: <arquivo>.js */
  /* pacotes grandes (.zip) vêm em partes base64: <arquivo>.1.js, <arquivo>.2.js ... (a parte 1 informa o total) */
  function carrega(src) { return new Promise((ok, falha) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = falha; document.head.append(sc); }); }
  async function emPartes(href) {
    const chave = href.replace(/^\.\//, ''); window.COE_ARQUIVOS = window.COE_ARQUIVOS || {}; window.COE_PARTES = window.COE_PARTES || {};
    const bin = [];
    for (let i = 1; ; i++) {
      const k = chave + '.' + i;
      if (!window.COE_ARQUIVOS[k]) await carrega(k + '.js' + (window.COE_PACOTE_V ? '?v=' + window.COE_PACOTE_V : ''));
      const b = atob(window.COE_ARQUIVOS[k]), u = new Uint8Array(b.length);
      for (let j = 0; j < b.length; j++) u[j] = b.charCodeAt(j);
      bin.push(u); delete window.COE_ARQUIVOS[k];
      if (i >= (window.COE_PARTES[chave] || 1)) break;
    }
    return new Blob(bin, { type: 'application/zip' });
  }

  /* Material completo em um único HTML: monta no navegador, a partir dos arquivos publicados (lista em js/pacote-lista.js) */
  const LOADER = function () {
  'use strict';
  var V = JSON.parse(document.getElementById('coe-vfs').textContent);
  var BLOBS = {};
  function bytes(k) { var s = atob(V[k][1]), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function texto(k) { return new TextDecoder('utf-8').decode(bytes(k)); }
  function blob(k) { if (!BLOBS[k]) BLOBS[k] = URL.createObjectURL(new Blob([bytes(k)], { type: V[k][0] })); return BLOBS[k]; }
  function dataUri(k) { return 'data:' + V[k][0] + ';base64,' + V[k][1]; }
  var DIR = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
  function resolver(raw, base) {
    if (typeof raw !== 'string' || !raw) return null;
    var s = raw.trim();
    if (s.indexOf(DIR) === 0) { s = s.slice(DIR.length); base = ''; }
    else if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(s)) return null;
    var hash = s.indexOf('#') >= 0 ? s.slice(s.indexOf('#')) : '';
    var p = s.split('#')[0].split('?')[0];
    var partes = ((base || '') + p).split('/'), out = [];
    for (var i = 0; i < partes.length; i++) { var x = partes[i]; if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }
    var k = out.join('/');
    try { k = decodeURIComponent(k); } catch (e) {}
    return V[k] ? { k: k, hash: hash } : null;
  }
  function documentoIframe(k, hash) {
    var base = k.replace(/[^/]*$/, '');
    var h = texto(k).replace(/(\s(?:src|href)=")([^"]+)"/g, function (m, a, v) {
      var r = resolver(v, base); return r && !/\.html$/.test(r.k) ? a + dataUri(r.k) + '"' : m;
    });
    var boot = '<script>parent.__coeVFS(window,' + JSON.stringify(base) + ');' +
      (hash ? 'try{history.replaceState(null,"",' + JSON.stringify(hash) + ')}catch(e){location.hash=' + JSON.stringify(hash) + '}' : '') + '<\/script>';
    return /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, function (m) { return m + boot; }) : boot + h;
  }
  function instalar(W, base) {
    var D = W.document, E = W.Element.prototype, setAttr = E.setAttribute, getAttr = E.getAttribute;
    function patch(Ctor, prop) {
      if (!Ctor) return;
      var d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop); if (!d || !d.set) return;
      Object.defineProperty(Ctor.prototype, prop, { configurable: true, enumerable: d.enumerable,
        get: function () { return this.__vfs && this.__vfs[prop] ? new URL(this.__vfs[prop], DIR + base).href : d.get.call(this); },
        set: function (v) {
          var r = resolver(String(v), base);
          if (!r) { if (this.__vfs) delete this.__vfs[prop]; return d.set.call(this, v); }
          (this.__vfs = this.__vfs || {})[prop] = String(v);
          if (Ctor === W.HTMLIFrameElement && /\.html$/.test(r.k)) { this.srcdoc = documentoIframe(r.k, r.hash); return setAttr.call(this, 'src', String(v)); }
          setAttr.call(this, prop, blob(r.k) + r.hash);
        } });
    }
    patch(W.HTMLImageElement, 'src'); patch(W.HTMLScriptElement, 'src'); patch(W.HTMLSourceElement, 'src');
    patch(W.HTMLIFrameElement, 'src'); patch(W.HTMLLinkElement, 'href');
    var TAGS = { IMG: 'src', SCRIPT: 'src', SOURCE: 'src', IFRAME: 'src', LINK: 'href' };
    E.setAttribute = function (n, v) {
      var a = TAGS[this.tagName];
      if (a && String(n).toLowerCase() === a && resolver(String(v), base)) { this[a] = v; return; }
      return setAttr.call(this, n, v);
    };
    E.getAttribute = function (n) {
      if (this.__vfs) { var a = TAGS[this.tagName]; if (a && String(n).toLowerCase() === a && this.__vfs[a]) return this.__vfs[a]; }
      return getAttr.call(this, n);
    };
    var fetchOrig = W.fetch;
    W.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : input && input.url, r = resolver(u, base);
      if (r) return Promise.resolve(new W.Response(new W.Blob([bytes(r.k)], { type: V[r.k][0] }), { status: 200, headers: { 'Content-Type': V[r.k][0] } }));
      return fetchOrig.apply(this, arguments);
    };
    function corrigir(el) {
      var a = TAGS[el.tagName]; if (!a || el.tagName === 'SCRIPT') return;
      var v = getAttr.call(el, a); if (!v || (el.__vfs && el.__vfs[a] === v)) return;
      if (resolver(v, base)) el[a] = v;
    }
    function varrer(n) { if (n.nodeType !== 1) return; corrigir(n); if (n.querySelectorAll) n.querySelectorAll('img,source,iframe,link').forEach(corrigir); }
    new W.MutationObserver(function (ms) {
      ms.forEach(function (m) { if (m.type === 'attributes') corrigir(m.target); else m.addedNodes.forEach(varrer); });
    }).observe(D.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] });
    if (D.body) varrer(D.body);
  }
  window.__coeVFS = instalar;
  instalar(window, '');
};
  const MIME = { js: 'text/javascript', html: 'text/html', json: 'application/json', csv: 'text/csv', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', css: 'text/css' };
  const PATCH = { 'sala-coe-3d/editor.js': [["new URL(serverMode?'../api/editor/state':'../dados/edicoes.json',location.href).href", "(serverMode?'../api/editor/state':'../dados/edicoes.json')"]] };
  const b64 = blob => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = falha; r.readAsDataURL(blob); });
  async function montaPacote(aviso) {
    if (!window.COE_LISTA) await carrega('js/pacote-lista.js?v=' + Date.now());
    const lista = window.COE_LISTA || [], V = {}, TXT = {};
    let feitos = 0;
    const um = async p => {
      const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status);
      const ext = (p.split('.').pop() || '').toLowerCase(), tipo = MIME[ext] || 'application/octet-stream';
      let blob = await r.blob();
      if (ext === 'js' || PATCH[p]) { let t = await blob.text(); (PATCH[p] || []).forEach(([a, b]) => { t = t.split(a).join(b); }); TXT[p] = t; blob = new Blob([t]); }
      V[p] = [tipo, await b64(blob)];
      feitos++; if (aviso) aviso(Math.round(100 * feitos / lista.length));
    };
    for (let i = 0; i < lista.length; i += 8) await Promise.all(lista.slice(i, i + 8).map(um));
    let html = await (await fetch('fonte.html?v=' + Date.now())).text();
    html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)>\s*<\/script>/g, (m, a1, src, a3) => {
      const p = src.split('?')[0].split('#')[0]; if (!V[p]) return m;
      const code = (TXT[p] != null ? TXT[p] : atob(V[p][1])).replace(/<\/script/gi, '<\\/script');
      return '<script' + a1 + a3 + '>' + code + '</' + 'script>'; });
    html = html.replace(/(<link[^>]*rel="icon"[^>]*href=")([^"]+)"/, (m, a, h) => { const p = h.split('?')[0]; return V[p] ? a + 'data:' + V[p][0] + ';base64,' + V[p][1] + '"' : m; });
    html = html.replace(/<a class="rodape-dl"[\s\S]*?<\/a>/, '');
    const cab = '<script type="application/json" id="coe-vfs">' + JSON.stringify(V) + '</' + 'script><script>(' + LOADER.toString() + ')();</' + 'script>';
    const m = /<head[^>]*>/i.exec(html);
    return new Blob([html.slice(0, m.index + m[0].length), cab, html.slice(m.index + m[0].length)], { type: 'text/html' });
  }
  window.coeMontaPacote = montaPacote;
  function embutido(href) {
    const chave = href.replace(/^\.\//, '');
    const pronto = () => {
      const b = atob(window.COE_ARQUIVOS[chave]), u = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
      return new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    if (window.COE_ARQUIVOS && window.COE_ARQUIVOS[chave]) return Promise.resolve(pronto());
    return new Promise((ok, falha) => {
      const sc = document.createElement('script');
      sc.src = chave + '.js';
      sc.onload = () => (window.COE_ARQUIVOS && window.COE_ARQUIVOS[chave] ? ok(pronto()) : falha(new Error('vazio')));
      sc.onerror = falha;
      document.head.append(sc);
    });
  }
  document.addEventListener('click', async e => {
    const a = e.target.closest && e.target.closest('a[download]');
    if (!a || a.dataset.coeNativo) return;
    if (a.hasAttribute('data-pacote')) {
      e.preventDefault(); if (a.classList.contains('baixando')) return;
      const t0 = a.innerHTML; a.classList.add('baixando');
      const aviso = n => { a.textContent = 'Preparando o arquivo… ' + n + '%'; };
      try { aviso(0); await window.coeBaixar(a.getAttribute('download') || 'COE_Holambra.html', await montaPacote(aviso)); }
      catch (err) { console.warn('pacote', err); }
      finally { a.innerHTML = t0; a.classList.remove('baixando'); }
      return;
    }
    const href = a.getAttribute('href');
    if (!href || /^(https?:)?\/\//.test(href) || href.startsWith('data:')) return;
    e.preventDefault();
    try {
      const nome = a.getAttribute('download') || href.split('/').pop().split('?')[0];
      if (/\.xlsx$/i.test(href)) { await window.coeBaixar(nome, await embutido(href)); return; }
      if (/\.zip$/i.test(href)) { const t = a.textContent; a.classList.add('baixando'); a.querySelector('span') ? null : 0; a.dataset.txt = t; a.textContent = 'Preparando o arquivo…'; try { await window.coeBaixar(nome, await emPartes(href)); } finally { a.textContent = a.dataset.txt; a.classList.remove('baixando'); } return; }
      const r = await fetch(href);
      if (!r.ok) throw new Error(r.status);
      await window.coeBaixar(nome, await r.blob());
    } catch (err) { console.warn('download', href, err); }
  });
  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.tipo !== 'coe:baixar' || e.origin !== location.origin) return;
    salvar(m.nome, m.dados);
  });
})();
