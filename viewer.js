// Instagram Saver viewer.
// opt.resolve(path) -> Promise<url>   turns a media path into a displayable URL
// opt.loadState() / opt.saveState(state)   persist favorites, tags, hidden and removed posts
// opt.fileSizes(paths) -> Promise<bytes | {bytes, approx}>   optional: total size of the media files (shown when exporting)
// opt.removeFiles(item)   optional: also delete the post's files (the button then says Delete instead of Remove)
function initViewer(root, opt) {
  opt = opt || {};
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num = v => v ? Number(v).toLocaleString() : '0';
  const when = d => { const t = new Date(String(d).replace(' ', 'T') + 'Z'); return isNaN(t) ? esc(d) : t.toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}); };
  const idcmp = (a, b) => a.length !== b.length ? a.length - b.length : (a < b ? -1 : a > b ? 1 : 0);
  const mnum = p => { const m = /_(\d+)\.[^.]+$/.exec(p); return m ? +m[1] : 0; };  // carousel position from a file name: 123_2.jpg -> 2
  const mediaOk = (i, m) => m === 'single' ? i.media.length === 1 : m === 'multi' ? i.media.length > 1 : m === 'images' ? !i.hasVid : m === 'videos' ? i.hasVid : true;
  const KEYS = ['from', 'has', 'tag', 'is', 'before', 'after'];

  let ui = {tab: 'all', view: 'feed', q: '', media: 'any', from: '', to: '', sort: 'new', author: '', tag: '', showHidden: false, otd: false, anchor: ''};
  try { Object.assign(ui, JSON.parse(ls('igs-ui') || '{}')); } catch (e) {}
  const saveUi = () => ls('igs-ui', JSON.stringify(ui));

  let state = {fav: {}, tags: {}, hidden: {}, deleted: {}};
  let all = [], byId = new Map(), authors = [], sc = {thumbs: {}, alias: {}, removed: {}};
  const todayKey = (() => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  let sel = new Set(), selectMode = false, lastSelId = null;
  try { JSON.parse(ls('igs-sel') || '[]').forEach(x => sel.add(String(x))); } catch (e) {}
  const saveSel = () => ls('igs-sel', JSON.stringify([...sel]));
  let view = [], wall = [], shown = 0, words = [], ready = false, userMoved = false;

  root.innerHTML = `
<div class="vw">
 <aside class="vw-side">
  <input class="vw-asq" placeholder="Find an account…">
  <div class="vw-h">Accounts</div><div class="vw-authors"></div>
  <div class="vw-h">Tags</div><div class="vw-taglist"></div>
 </aside>
 <main class="vw-main">
  <div class="vw-tabs">
   <button data-tab="all">All</button><button data-tab="photos">Photos</button><button data-tab="videos">Videos</button><button data-tab="fav">Favorites</button>
   <span class="vw-sp"></span>
   <button class="vw-sbtn" data-act="side">Accounts &amp; tags</button>
  </div>
  <div class="vw-searchrow"><span class="vw-qwrap"><input class="vw-q" placeholder="Search saved posts"><button class="vw-qclear" data-act="qclear" aria-label="Clear the search and its filters" title="Clear the search and its filters" hidden>×</button></span><button class="vw-help" data-act="tips" aria-label="Search tips" title="Search tips">?</button></div>
  <div class="vw-tips" hidden>Search tips: <code>"exact phrase"</code> · <code>-word</code> to exclude · <code>from:name</code> · <code>has:video</code> or <code>has:image</code> · <code>tag:funny</code> · <code>is:fav</code> · <code>before:2024-01-01</code> · <code>after:2024-01-01</code></div>
  <div class="vw-toolbar">
   <span class="vw-fwrap"><button class="vw-fbtn" data-act="filters">Filters<b class="vw-fcount"></b> ▾</button>
    <div class="vw-fpanel" hidden>
     <label class="vw-frow">Show <select class="vw-media"><option value="any">All posts</option><option value="single">Single photo or video</option><option value="multi">Carousels (several photos or videos)</option></select></label>
     <div class="vw-frow"><span>From <input type="date" class="vw-from"></span><span>To <input type="date" class="vw-to"></span></div>
     <label class="vw-frow"><input type="checkbox" class="vw-showhid"> Show hidden posts</label>
     <a class="vw-clear" data-act="clear">Reset all filters</a>
    </div></span>
   <select class="vw-sort"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="likes">Most liked</option></select>
   <button class="vw-otd" data-act="otd" title="Posts from today's date in earlier years">On this day</button>
   <span class="vw-sp"></span>
   <span class="vw-seg"><button data-view="feed">Feed</button><button data-view="wall">Media wall</button></span>
   <span class="vw-tgrp">
   <button class="vw-selbtn" data-act="selmode" title="Tick posts one by one to export or review them">Select</button>
   <span class="vw-expwrap"><button class="vw-expbtn" data-act="export">Export ▾</button>
    <span class="vw-expmenu" hidden><button data-act="exp-csv">Spreadsheet (CSV)</button><button data-act="exp-json">JSON file</button><button data-act="exp-print">Printable page / PDF</button></span></span>
   </span>
  </div>
  <div class="vw-note"></div>
  <div class="vw-selbar" hidden><b class="vw-selcount"></b><button data-act="selall"></button><button data-act="selclear">Clear</button><button class="go" data-act="selexport">Export selected…</button><button data-act="seldone">Done</button><span class="vw-selhint">Tip: hold Shift to select a range.</span></div>
  <div class="vw-chiprow"><div class="vw-chips"></div><span class="vw-count"></span></div>
  <div class="vw-list"></div><div class="vw-sentinel"></div>
 </main>
</div>
<div class="vw-lb"><button class="x" data-act="lbx" aria-label="Close">×</button><button class="pv" data-act="lbp" aria-label="Previous">‹</button><button class="nx" data-act="lbn" aria-label="Next">›</button>
 <div class="vw-stage"></div><div class="vw-cap"></div></div>
<div class="vw-expd"><div class="vw-expbox"></div></div>
<div class="vw-modal"><div class="vw-mbox"><div class="mh"><span>Post</span><button data-act="mx">Close</button></div><div class="mbody"></div></div></div>`;
  const $ = s => root.querySelector(s);
  const side = $('.vw-side'), listEl = $('.vw-list'), sentinel = $('.vw-sentinel'), mainEl = $('.vw-main');
  const lbEl = $('.vw-lb'), stageEl = $('.vw-stage'), modalEl = $('.vw-modal');

  // ---------- saved state (favorites, tags, hidden, deleted) ----------
  async function loadState() {
    try { const x = opt.loadState && await opt.loadState(); if (x) Object.assign(state, x); } catch (e) {}
  }
  let saveTimer;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { opt.saveState && opt.saveState(JSON.parse(JSON.stringify(state))); } catch (e) {} }, 250);
  }

  // ---------- search ----------
  function parseQ(q) {
    const out = [], re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
    let m;
    while ((m = re.exec(q))) {
      let val = (m[3] !== undefined ? m[3] : m[4]).toLowerCase(), key = m[2] ? m[2].toLowerCase() : '';
      if (key && KEYS.indexOf(key) < 0) { val = key + ':' + val; key = ''; }
      if (val) out.push({neg: !!m[1], key, val});
    }
    return out;
  }
  function matchTerm(i, t) {
    let ok;
    const v = t.val.replace(/^@/, '');
    switch (t.key) {
      case 'from': ok = i.handle.toLowerCase().indexOf(v) >= 0 || i.author.toLowerCase().indexOf(v) >= 0; break;
      case 'has': ok = v === 'video' ? i.hasVid : v === 'image' || v === 'photo' ? i.hasImg : v === 'media' ? i.media.length > 0 : v === 'link' ? /https?:\/\//.test(i.text) : false; break;
      case 'tag': ok = (state.tags[i.id] || []).some(x => x.toLowerCase() === v); break;
      case 'is': ok = v === 'fav' || v === 'favorite' ? !!state.fav[i.id] : v === 'hidden' ? !!state.hidden[i.id] : v === 'video' ? i.hasVid : v === 'photo' ? i.hasImg : false; break;
      case 'before': ok = i.date.slice(0, 10) < t.val; break;
      case 'after': ok = i.date.slice(0, 10) > t.val; break;
      default: ok = i.hay.indexOf(t.val) >= 0;
    }
    return t.neg ? !ok : ok;
  }

  // ---------- data ----------
  function ingest(items) {
    all = (items || []).filter(i => i && i.id != null).map(i => {
      i.id = String(i.id); i.text = String(i.text || ''); i.author = String(i.author || ''); i.handle = String(i.handle || '');
      i.date = String(i.date || ''); i.kind = i.kind || 'saved'; i.media = Array.isArray(i.media) ? i.media : [];
      i.code = String(i.code || ''); i.place = String(i.place || '');
      return i;
    });
    byId = new Map();
    for (const i of all) {
      i.hay = (i.text + ' ' + i.author + ' @' + i.handle + ' ' + i.place).toLowerCase();
      i.hasVid = i.media.some(m => m.video);
      i.hasImg = i.media.some(m => !m.video);
      byId.set(i.id, i);
      i.otd = i.date.slice(5, 10) === todayKey;
    }
    applySidecars();
    buildAuthors();
  }
  function applySidecars(next) {
    if (next) sc = {thumbs: next.thumbs || {}, alias: next.alias || {}, removed: next.removed || {}};
    const changed = [], rmBy = {};
    for (const p in sc.removed) { const m = /^(saved)\/(\d+)_/.exec(p); if (m) (rmBy[m[2]] = rmBy[m[2]] || []).push([m[1], p]); }
    for (const i of all) {
      let ch = false;
      for (const [kind, p] of rmBy[i.id] || []) {  // files deleted to save space still show up as a note on the post
        if (kind === i.kind && !i.media.some(x => (x.o || x.url) === p)) { i.media.push({url: p, o: p, video: /\.(mp4|webm|mov|m4v)$/i.test(p)}); i.media.sort((a, b) => mnum(a.o || a.url) - mnum(b.o || b.url)); ch = true; }
      }
      for (const m of i.media) {
        const o = m.o || m.url, url = sc.alias[o] || o, t = m.video ? sc.thumbs[url] : null, d = t ? t.d : 0, th = t && t.t ? t.t : '';
        const rm = sc.removed[url] || sc.removed[o], rmf = !!rm, size = rm ? rm.size : 0;
        if (url !== m.url || d !== (m.dur || 0) || th !== (m.thumb || '') || rmf !== !!m.removed) ch = true;
        m.o = o; m.url = url; m.dur = d; m.thumb = th; m.removed = rmf; m.size = size;
      }
      if (ch) changed.push(i.id);
    }
    const n = all.filter(i => i.otd && !state.deleted[i.id]).length, b = $('.vw-otd');
    if (b) { const t = `On this day${n ? ' (' + n + ')' : ''}`; if (b.textContent !== t) b.textContent = t; b.disabled = !n; }
    return changed;
  }
  function buildAuthors() {
    const m = new Map();
    for (const i of all) {
      if (state.deleted[i.id] || !i.handle) continue;
      const a = m.get(i.handle) || {handle: i.handle, name: i.author, n: 0};
      a.n++; m.set(i.handle, a);
    }
    authors = Array.from(m.values()).sort((a, b) => b.n - a.n);
  }
  function compute() {
    const terms = parseQ(ui.q);
    words = terms.filter(t => !t.neg && !t.key).map(t => t.val).filter(w => w.length > 1);
    const tg = ui.tag.toLowerCase();
    view = all.filter(i => {
      if (state.deleted[i.id]) return false;
      if (ui.tab === 'photos') { if (i.hasVid) return false; }
      else if (ui.tab === 'videos') { if (!i.hasVid) return false; }
      else if (ui.tab === 'fav' && !state.fav[i.id]) return false;
      if (state.hidden[i.id] && !ui.showHidden) return false;
      if (ui.author && i.handle !== ui.author) return false;
      if (tg && !(state.tags[i.id] || []).some(t => t.toLowerCase() === tg)) return false;
      if (!mediaOk(i, ui.media)) return false;
      if (ui.otd && !i.otd) return false;
      const d = i.date.slice(0, 10);
      if (ui.from && d < ui.from) return false;
      if (ui.to && d > ui.to) return false;
      return terms.every(t => matchTerm(i, t));
    });
    const dcmp = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : idcmp(a.id, b.id);
    if (ui.sort === 'old') view.sort(dcmp);
    else if (ui.sort === 'likes') view.sort((a, b) => (b.likes || 0) - (a.likes || 0) || dcmp(b, a));
    else view.sort((a, b) => dcmp(b, a));
    wall = [];
    if (ui.view === 'wall') for (const i of view) i.media.forEach((m, k) => { if (!m.removed) wall.push({url: m.url, video: m.video, id: i.id, k, dur: m.dur, thumb: m.thumb}); });
  }

  // ---------- rendering ----------
  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])@([A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?)/g, '$1<a href="https://www.instagram.com/$2/" target="_blank" rel="noopener">@$2</a>')
      .replace(/(^|[\s(])#([\p{L}\p{N}_]+)/gu, (m, pre, tag) => pre + '<a href="https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/" target="_blank" rel="noopener">#' + tag + '</a>');
  }
  function highlight(html) {
    if (!words.length) return html;
    const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return html.split(/(<[^>]+>)/).map(p => p[0] === '<' ? p : p.replace(re, '<mark>$1</mark>')).join('');
  }
  function mediaHtml(i) {
    if (!i.media.length) return '';
    const m = i.media.slice(0, 4), extra = i.media.length - 4;
    return `<div class="vw-media n${m.length}">` + m.map((x, k) => {
      if (x.removed) return `<div class="vw-gone-media">${x.thumb ? `<img data-p="${esc(x.thumb)}" alt="">` : ''}<span class="vw-rmbadge">${x.video ? 'Video' : 'File'} removed to save space${x.size ? ' · ' + fmtSize(x.size) : ''}</span></div>`;
      const more = k === 3 && extra > 0 ? `<span class="vw-more">+${extra}</span>` : '';
      return x.video
        ? `<div class="vw-vid" data-act="lb" data-id="${i.id}" data-k="${k}">${x.thumb ? `<img data-p="${esc(x.thumb)}" alt="">` : `<video data-p="${esc(x.url)}" preload="metadata" muted></video>`}<span class="vw-play">▶</span><span class="vw-dur">${x.dur ? fmtDur(x.dur) : ''}</span>${more}</div>`
        : `<div class="vw-mw" data-act="lb" data-id="${i.id}" data-k="${k}"><img data-p="${esc(x.url)}">${more}</div>`;
    }).join('') + '</div>';
  }
  function card(i, ctx, cur) {
    const fav = state.fav[i.id], hid = state.hidden[i.id], tags = state.tags[i.id] || [];
    return `<div class="vw-tw ctx-${ctx}${hid ? ' hidden' : ''}${cur ? ' cur' : ''}${sel.has(i.id) && selectMode && ctx === 'feed' ? ' picked' : ''}" data-id="${i.id}" data-ctx="${ctx}">` +
      (selectMode && ctx === 'feed' ? `<input type="checkbox" class="vw-selbox" data-act="sel" data-id="${i.id}" ${sel.has(i.id) ? 'checked' : ''} aria-label="Select this post">` : '') +
      `<div class="av">${esc((i.author || '?').slice(0, 1).toUpperCase())}</div><div class="body">` +
      `<div class="hd"><b>${esc(i.author)}</b> <span>@${esc(i.handle)} · ${when(i.date)}</span></div>` +
      `<div class="txt">${highlight(linkify(i.text))}</div>` + mediaHtml(i) +
      (tags.length ? `<div class="vw-tags">${tags.map(t => `<span class="vw-tagchip" data-act="tagfilter" data-tag="${esc(t)}">${esc(t)}<u data-act="rmtag" data-tag="${esc(t)}" title="Remove tag">×</u></span>`).join('')}</div>` : '') +
      `<div class="ft">${i.likes ? `<span>♡ ${num(i.likes)}</span>` : ''}` +
      `<button data-act="fav" class="${fav ? 'on' : ''}">${fav ? '★ Favorited' : '☆ Favorite'}</button><button data-act="tag">+ Tag</button>` +
      `<button data-act="hide">${hid ? 'Unhide' : 'Hide'}</button>` + `<button data-act="del" class="danger">${opt.removeFiles ? 'Delete' : 'Remove'}</button>` +
      `<a href="https://www.instagram.com/p/${esc(i.code)}/" target="_blank" rel="noopener">View on Instagram</a></div></div></div>`;
  }
  function tile(w, n) {
    const p = esc(w.url);
    return `<div class="vw-tile" data-act="wl" data-n="${n}">` + (w.video ? (w.thumb ? `<img data-p="${esc(w.thumb)}" alt="">` : `<video data-p="${p}" preload="metadata" muted></video>`) + `<span class="vw-play">▶</span><span class="vw-dur">${w.dur ? fmtDur(w.dur) : ''}</span>` : `<img data-p="${p}" alt="">`) + '</div>';
  }

  // ---------- lazy media (files are read from your folder only when scrolled into view) ----------
  function loadMedia(el) {
    const p = el.dataset.p, r = el.dataset.r, isVid = el.tagName === 'VIDEO';
    if (!p) { if (r) el.src = r; return; }
    if (isVid) el.onloadedmetadata = () => { const b = el.parentNode && el.parentNode.querySelector('.vw-dur'); if (b && !b.textContent && isFinite(el.duration)) b.textContent = fmtDur(el.duration); };
    opt.resolve(p).then(u => { el.src = isVid ? u + '#t=0.1' : u; el.classList.remove('missing'); })
      .catch(() => { if (r) el.src = r; else { el.classList.add('missing'); el.dataset.h = ''; } });
  }
  const mio = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { mio.unobserve(en.target); loadMedia(en.target); } }), {rootMargin: '700px'}) : null;
  function watchMedia(node) {
    if (node.nodeType !== 1) return;
    const list = node.matches('[data-p]') ? [node] : [];
    if (node.querySelectorAll) list.push(...node.querySelectorAll('[data-p]'));
    for (const el of list) { if (el.dataset.h === '1') continue; el.dataset.h = '1'; mio ? mio.observe(el) : loadMedia(el); }
  }
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(watchMedia))).observe(root, {childList: true, subtree: true});

  // ---------- infinite scroll ----------
  function more() {
    const wallMode = ui.view === 'wall', src = wallMode ? wall : view;
    if (shown >= src.length) return;
    const end = Math.min(shown + (wallMode ? 60 : 25), src.length);
    let html = '';
    for (let k = shown; k < end; k++) { try { html += wallMode ? tile(src[k], k) : card(src[k], 'feed'); } catch (e) { console.error('Could not draw post', src[k] && src[k].id, e); } }
    listEl.insertAdjacentHTML('beforeend', html);
    shown = end;
    updateCount();
    requestAnimationFrame(check);
  }
  function check() { if (shown < (ui.view === 'wall' ? wall : view).length && sentinel.getBoundingClientRect().top < innerHeight + 1200) more(); }
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, {rootMargin: '1200px'}).observe(sentinel);
  else addEventListener('scroll', check);

  function updateCount() {
    const wallMode = ui.view === 'wall';
    const otdNote = ui.otd && view.length ? `On this day, ${(() => { const ys = view.map(i => i.date.slice(0, 4)).sort(); return ys[0] === ys[ys.length - 1] ? ys[0] : ys[0] + '–' + ys[ys.length - 1]; })()} · ` : '';
    $('.vw-count').textContent = view.length ? otdNote + (wallMode ? `${wall.length.toLocaleString()} photos & videos from ${view.length.toLocaleString()} posts` : `Showing ${shown.toLocaleString()} of ${view.length.toLocaleString()} posts`) : '';
  }

  function refresh(keepScroll) {
    compute();
    listEl.innerHTML = '';
    listEl.className = 'vw-list' + (ui.view === 'wall' ? ' vw-wall' : '');
    mainEl.classList.toggle('wall', ui.view === 'wall');
    shown = 0;
    if (!view.length) { listEl.innerHTML = `<div class="vw-empty">${all.length ? 'No posts match.' : 'Nothing saved yet.'}</div>`; }
    else more();
    if (!keepScroll) scrollTo(0, 0);
    syncControls(); renderSide(); renderChips(); updateCount(); saveUi();
  }
  function syncControls() {
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    root.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
    if (document.activeElement !== $('.vw-q')) $('.vw-q').value = ui.q;
    updateQClear();
    $('.vw-media').value = ui.media; $('.vw-sort').value = ui.sort;
    $('.vw-from').value = ui.from; $('.vw-to').value = ui.to; $('.vw-showhid').checked = ui.showHidden;
    $('.vw-otd').classList.toggle('on', ui.otd);
    $('.vw-selbtn').classList.toggle('on', selectMode); updateSelBar();
    
  }
  function updateQClear() { const b = $('.vw-qclear'); if (b) b.hidden = !($('.vw-q').value || ui.q || ui.author || ui.tag); }
  function updateSelBar() {
    const bar = $('.vw-selbar'); if (!bar) return;
    bar.hidden = !selectMode;
    $('.vw-selcount').textContent = `${sel.size.toLocaleString()} selected`;
    bar.querySelector('[data-act=selall]').textContent = `Select all ${view.length.toLocaleString()} shown`;
    bar.querySelector('[data-act=selexport]').disabled = !sel.size;
  }
  function syncSelBoxes() {
    listEl.querySelectorAll('.vw-selbox').forEach(b => { b.checked = sel.has(b.dataset.id); const c = b.closest('.vw-tw'); if (c) c.classList.toggle('picked', b.checked); });
  }
  function renderChips() {
    const MEDIA = {single: 'Single photo or video', multi: 'Carousels'};
    const chip = (act, label) => `<span class="vw-tagchip" data-act="${act}">${label} ×</span>`;
    let h = '', n = 0;
    if (sel.size && !selectMode) h += chip('clrsel', `${sel.size.toLocaleString()} selected`);
    if (ui.author) h += chip('clrauthor', `Account: @${esc(ui.author)}`);
    if (ui.tag) h += chip('clrtag', `Tag: ${esc(ui.tag)}`);
    if (ui.otd) h += chip('clrotd', 'On this day');
    if (ui.media !== 'any') { h += chip('clrmedia', MEDIA[ui.media] || ui.media); n++; }
    if (ui.from || ui.to) { h += chip('clrdates', `${ui.from ? 'From ' + esc(ui.from) : ''}${ui.from && ui.to ? ' ' : ''}${ui.to ? 'to ' + esc(ui.to) : ''}`); n++; }
    if (ui.showHidden) { h += chip('clrhidden', 'Showing hidden'); n++; }
    $('.vw-chips').innerHTML = h;
    $('.vw-fcount').textContent = n ? ' · ' + n : '';
    $('.vw-fbtn').classList.toggle('on', n > 0);
  }
  function renderSide() {
    const q = $('.vw-asq').value.toLowerCase().replace(/^@/, '');
    const list = authors.filter(a => !q || a.handle.toLowerCase().indexOf(q) >= 0 || a.name.toLowerCase().indexOf(q) >= 0).slice(0, 300);
    $('.vw-authors').innerHTML = list.map(a => `<div class="vw-arow${ui.author === a.handle ? ' on' : ''}" data-act="author" data-h="${esc(a.handle)}">` +
      `<i>${esc((a.name || '?').slice(0, 1).toUpperCase())}</i><span>${esc(a.name)}</span><em>${a.n}</em></div>`).join('') || '<div class="vw-empty">No accounts</div>';
    const counts = {};
    for (const id in state.tags) if (!state.deleted[id]) for (const t of state.tags[id]) counts[t] = (counts[t] || 0) + 1;
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    $('.vw-taglist').innerHTML = names.map(t => `<span class="vw-tagchip${ui.tag.toLowerCase() === t.toLowerCase() ? ' on' : ''}" data-act="tagfilter" data-tag="${esc(t)}">${esc(t)}<b>${counts[t]}</b></span>`).join('') || '<div class="vw-empty" style="padding:8px 0;text-align:left">Add tags with "+ Tag" on any post.</div>';
  }

  // ---------- lightbox ----------
  let lb = {list: [], i: 0};
  function openLb(list, i) { lb = {list, i}; showLb(); }
  function showLb() {
    const x = lb.list[lb.i]; if (!x) return;
    lbEl.classList.add('open');
    stageEl.innerHTML = x.removed ? '<div style="padding:30px;color:#fff;text-align:center">This file was deleted to save space.<br>The post and its caption are still saved.</div>' : x.video ? '<video controls autoplay></video>' : '<img alt="">';
    const el = stageEl.firstChild, mine = lb.i;
    if (!x.removed) opt.resolve(x.url).then(u => { if (lb.i === mine && stageEl.firstChild === el) el.src = u; })
      .catch(() => { if (lb.i === mine) stageEl.innerHTML = '<div style="padding:30px;color:#fff;text-align:center">This file is not available right now.<br>Reconnect your folder (top of the page) and try again.</div>'; });
    const t = byId.get(x.id);
    $('.vw-cap').innerHTML = (t ? `<b>${esc(t.author)}</b> @${esc(t.handle)} — ${esc(t.text.slice(0, 160))}${t.text.length > 160 ? '…' : ''}<a data-act="post" data-id="${t.id}">Open post</a>` : '') + `<div>${lb.i + 1} / ${lb.list.length}</div>`;
    const nx = lb.list[lb.i + 1];
    if (nx && !nx.video) opt.resolve(nx.url).then(u => { new Image().src = u; }).catch(() => {});
  }
  function closeLb() { lbEl.classList.remove('open'); stageEl.innerHTML = ''; }
  function stepLb(d) { if (!lbEl.classList.contains('open')) return; lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLb(); }

  // ---------- single post window ----------
  function openPost(id) {
    const t = byId.get(id); if (!t) return;
    modalEl.querySelector('.mbody').innerHTML = card(t, 'modal', true);
    modalEl.classList.add('open');
  }
  const closeModal = () => modalEl.classList.remove('open');

  // ---------- actions ----------
  function rerenderCard(id) {
    const i = byId.get(id); if (!i) return;
    root.querySelectorAll(`.vw-tw[data-id="${id}"]`).forEach(el => { el.outerHTML = card(i, el.dataset.ctx, el.classList.contains('cur')); });
  }
  function dropFromView(id) {
    const idx = view.findIndex(i => i.id === id);
    if (idx >= 0) { view.splice(idx, 1); if (idx < shown) shown--; }
    listEl.querySelectorAll(`.vw-tw[data-id="${id}"]`).forEach(el => el.remove());
    updateCount();
  }
  async function deletePost(id) {
    const i = byId.get(id); if (!i) return;
    const msg = opt.removeFiles
      ? `Delete this post by @${i.handle} and its ${i.media.length} photo/video file(s)?\n\nThe files are moved to the "_deleted" folder inside your downloads folder, not erased.`
      : `Remove this post by @${i.handle} from your library?\n\nYour files are not touched. You can bring removed posts back in Settings.`;
    if (!confirm(msg)) return;
    if (opt.removeFiles) { try { await opt.removeFiles(i); } catch (e) { alert('Could not delete: ' + e.message); return; } }
    state.deleted[id] = 1; delete state.fav[id]; delete state.tags[id]; delete state.hidden[id];
    saveState(); dropFromView(id); closeModal(); buildAuthors(); renderSide();
  }

  // ---------- export what you are looking at ----------
  const csvCell = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function exportRows(items) {
    return (items || view).map(i => ({date: i.date, author: i.author, handle: i.handle, caption: i.text, likes: i.likes || 0, place: i.place,
      photos: i.media.filter(m => !m.video).length, videos: i.media.filter(m => m.video).length, link: `https://www.instagram.com/p/${i.code}/`,
      tags: (state.tags[i.id] || []).join('; '), favorite: state.fav[i.id] ? 'yes' : ''}));
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fmtSize = b => b >= 1e12 ? (b / 1e12).toFixed(2) + ' TB' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : b >= 1e3 ? (b / 1e3).toFixed(0) + ' KB' : b + ' bytes';
  const newestFirst = (a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : -idcmp(a.id, b.id);
  function describeView() {
    const p = [], M = {single: 'single photos or videos', multi: 'carousels'};
    if (ui.tab === 'photos') p.push('Photos only'); else if (ui.tab === 'videos') p.push('Videos only'); else if (ui.tab === 'fav') p.push('Favorites only');
    if (ui.q) p.push('search "' + ui.q + '"');
    if (ui.author) p.push('author @' + ui.author);
    if (ui.tag) p.push('tag "' + ui.tag + '"');
    if (ui.media !== 'any') p.push(M[ui.media]);
    if (ui.from || ui.to) p.push('dates ' + (ui.from || 'start') + ' to ' + (ui.to || 'today'));
    if (ui.otd) p.push('on this day'); if (ui.showHidden) p.push('including hidden');
    return p.length ? p.join(' · ') : 'Everything in your library';
  }
  function exportBuild(kind, rows, stamp) {
    if (kind === 'csv') { const cols = Object.keys(rows[0]); return {name: `instagram-posts-${stamp}.csv`, text: '﻿' + cols.join(',') + '\r\n' + rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\r\n'), type: 'text/csv'}; }
    if (kind === 'json') return {name: `instagram-posts-${stamp}.json`, text: JSON.stringify(rows, null, 1), type: 'application/json'};
    return null;
  }
  function printPage(rows) {
    if (rows.length > 1000 && !confirm(`This will make a printable page with ${rows.length.toLocaleString()} posts. That can be long. Continue?`)) return;
    const w = window.open('', '_blank'); if (!w) { alert('Your browser blocked the new window. Allow pop-ups for this page and try again.'); return; }
    w.document.write('<!doctype html><meta charset="utf-8"><title>Saved posts</title><style>body{font:14px -apple-system,Helvetica,sans-serif;max-width:720px;margin:20px auto;color:#111}h1{font-size:20px}.t{border-bottom:1px solid #ddd;padding:10px 0;page-break-inside:avoid}.m{color:#555;font-size:12px}.x{white-space:pre-wrap;margin:4px 0}</style><h1>Saved posts (' + rows.length.toLocaleString() + ')</h1>' +
      rows.map(r => `<div class="t"><b>${esc(r.author)}</b> <span class="m">@${esc(r.handle)} · ${esc(r.date)}</span><div class="x">${esc(r.caption)}</div><div class="m">♡ ${r.likes} · ${r.photos} photo(s), ${r.videos} video(s)${r.tags ? ' · tags: ' + esc(r.tags) : ''}<br>${esc(r.link)}</div></div>`).join(''));
    w.document.close(); setTimeout(() => w.print(), 500);
  }

  // ----- choosing which posts to export -----
  const EXPORT_KINDS = {csv: 'Spreadsheet (CSV)', json: 'JSON file', print: 'Printable page / PDF'};
  const EXPORT_WHAT = {
    csv: 'A spreadsheet file (.csv) that opens in Excel, Numbers or Google Sheets.',
    json: 'A data file (.json), mainly useful for developers.',
    print: 'A page you can print or save as a PDF. Nothing is downloaded until you choose Print.'
  };
  const C0 = {media: 'any', from: '', to: '', authors: '', tags: [], fav: false, hidden: false, minLikes: '', q: '', limit: ''};
  const exp = {scope: 'view', kind: 'csv', c: Object.assign({}, C0)};
  try { Object.assign(exp.c, JSON.parse(ls('igs-expc') || '{}')); } catch (e) {}
  const baseItems = () => all.filter(i => !state.deleted[i.id]);
  function customItems(c) {
    const terms = parseQ(c.q || ''), authors = String(c.authors || '').split(',').map(x => x.trim().replace(/^@/, '').toLowerCase()).filter(Boolean), tags = (c.tags || []).map(t => t.toLowerCase());
    let out = baseItems().filter(i => {
      if (!c.hidden && state.hidden[i.id]) return false;
      if (!mediaOk(i, c.media)) return false;
      const d = i.date.slice(0, 10);
      if (c.from && d < c.from) return false;
      if (c.to && d > c.to) return false;
      if (authors.length && !authors.some(a => i.handle.toLowerCase() === a || i.author.toLowerCase().indexOf(a) >= 0)) return false;
      if (tags.length && !(state.tags[i.id] || []).some(t => tags.indexOf(t.toLowerCase()) >= 0)) return false;
      if (c.fav && !state.fav[i.id]) return false;
      if (c.minLikes && (i.likes || 0) < +c.minLikes) return false;
      return terms.every(t => matchTerm(i, t));
    }).sort(newestFirst);
    if (+c.limit > 0) out = out.slice(0, +c.limit);
    return out;
  }
  const scopeItems = () => exp.scope === 'view' ? view : exp.scope === 'sel' ? baseItems().filter(i => sel.has(i.id)).sort(newestFirst) : exp.scope === 'all' ? baseItems().sort(newestFirst) : customItems(exp.c);
  function describeCustom(c) {
    const p = [], M = {single: 'single photos or videos', multi: 'carousels', images: 'photos only', videos: 'with videos'};
    if (c.media !== 'any') p.push(M[c.media]);
    if (c.from || c.to) p.push('dates ' + (c.from || 'start') + ' to ' + (c.to || 'today'));
    if (c.authors.trim()) p.push('authors ' + c.authors.trim());
    if (c.tags.length) p.push('tags ' + c.tags.join(', '));
    if (c.fav) p.push('favorites'); if (c.hidden) p.push('including hidden');
    if (c.minLikes) p.push(c.minLikes + '+ likes'); if (c.q.trim()) p.push('matching "' + c.q.trim() + '"'); if (+c.limit > 0) p.push('newest ' + c.limit + ' only');
    return p.length ? p.join(' · ') : 'All posts';
  }
  let expToken = 0, expTimer;
  function openExport(kind, scope) {
    if (!all.length) { alert('There is nothing to export yet.'); return; }
    exp.kind = kind || exp.kind;
    exp.scope = scope || (sel.size && selectMode ? 'sel' : view.length ? 'view' : 'all');
    renderExport(); $('.vw-expd').classList.add('open');
  }
  const closeExport = () => { $('.vw-expd').classList.remove('open'); expToken++; clearTimeout(expTimer); };
  function readExportForm() {
    const box = $('.vw-expbox'), c = exp.c, v = sel_ => box.querySelector(sel_);
    const r = box.querySelector('input[name=vwscope]:checked'); if (r) exp.scope = r.value;
    c.media = v('.c-media').value; c.from = v('.c-from').value; c.to = v('.c-to').value;
    c.authors = v('.c-authors').value; c.tags = [...box.querySelectorAll('.c-tag:checked')].map(x => x.value);
    c.fav = v('.c-fav').checked; c.hidden = v('.c-hidden').checked; c.minLikes = v('.c-minlikes').value; c.q = v('.c-q').value; c.limit = v('.c-limit').value;
    ls('igs-expc', JSON.stringify(c));
  }
  function renderExport() {
    const c = exp.c, tagNames = Object.keys(Object.values(state.tags).reduce((m, a) => { a.forEach(t => { m[t] = 1; }); return m; }, {})).sort();
    const scopeRow = (val, title, sub) => `<label class="vw-ex-scope${exp.scope === val ? ' on' : ''}"><input type="radio" name="vwscope" value="${val}" ${exp.scope === val ? 'checked' : ''}><span class="vw-ex-st"><b>${title}</b><em class="vw-ex-n" data-n="${val}"></em><span class="vw-ex-sub">${sub}</span></span></label>`;
    $('.vw-expbox').innerHTML =
      `<h3>Export posts</h3>` +
      `<div class="vw-ex-sec">1. Which posts?</div>` +
      scopeRow('view', "What I'm looking at now", esc(describeView())) +
      scopeRow('sel', "Posts I've ticked", sel.size ? 'Picked with Select in the toolbar.' : 'None yet. Use Select in the toolbar to tick posts one by one. Shift-click picks a range.') +
      scopeRow('all', 'Everything in my library', 'Every saved post, newest first.') +
      scopeRow('custom', 'Choose by rules…', 'Combine media, dates, accounts, tags and more.') +
      `<div class="vw-ex-custom" ${exp.scope === 'custom' ? '' : 'hidden'}>` +
        `<div class="vw-cgrid">` +
        `<div class="vw-cf"><span class="vw-cl">Media</span><select class="c-media">${[['any', 'Any'], ['single', 'Single photo or video'], ['multi', 'Carousels'], ['images', 'Photos only'], ['videos', 'Has videos']].map(([k, t]) => `<option value="${k}" ${c.media === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>` +
        `<div class="vw-cf"><span class="vw-cl">Posted between</span><input type="date" class="c-from" value="${esc(c.from)}"> <input type="date" class="c-to" value="${esc(c.to)}"></div>` +
        `<div class="vw-cf"><span class="vw-cl">Accounts</span><input class="c-authors" list="vw-adl" placeholder="@name, @name2 (empty = anyone)" value="${esc(c.authors)}"><datalist id="vw-adl">${authors.slice(0, 200).map(a => `<option value="@${esc(a.handle)}">${esc(a.name)}</option>`).join('')}</datalist></div>` +
        `<div class="vw-cf"><span class="vw-cl">Tags</span>${tagNames.length ? tagNames.map(t => `<label class="vw-ctag"><input type="checkbox" class="c-tag" value="${esc(t)}" ${(c.tags || []).includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('') : '<span class="vw-ex-sub">No tags yet</span>'}</div>` +
        `<div class="vw-cf"><span class="vw-cl">Only</span><label><input type="checkbox" class="c-fav" ${c.fav ? 'checked' : ''}> Favorites</label> <label><input type="checkbox" class="c-hidden" ${c.hidden ? 'checked' : ''}> Include hidden</label></div>` +
        `<div class="vw-cf"><span class="vw-cl">At least</span><input type="number" min="0" class="c-minlikes" style="width:90px" placeholder="0" value="${esc(c.minLikes)}"> likes</div>` +
        `<div class="vw-cf"><span class="vw-cl">Contains</span><input class="c-q" placeholder='words, #hashtag, "exact phrase", -exclude, has:video' value="${esc(c.q)}"></div>` +
        `<div class="vw-cf"><span class="vw-cl">Limit</span>newest <input type="number" min="0" class="c-limit" style="width:90px" placeholder="all" value="${esc(c.limit)}"> posts</div>` +
        `</div></div>` +
      `<div class="vw-ex-sec">2. Format</div>` +
      `<div class="vw-ex-kinds">${Object.keys(EXPORT_KINDS).map(k => `<button data-act="expk-${k}" class="${k === exp.kind ? 'on' : ''}">${EXPORT_KINDS[k]}</button>`).join('')}</div>` +
      `<p class="vw-ex-what">${EXPORT_WHAT[exp.kind]}</p>` +
      `<div class="vw-ex-sec">3. What you'll get</div><div class="vw-ex-summary"></div>` +
      `<div class="vw-ex-btns"><button class="go" data-act="expgo">${exp.kind === 'print' ? 'Open printable page' : 'Download file'}</button><button data-act="expx">Cancel</button></div>`;
    updateExportSummary();
  }
  function updateExportSummary() {
    const box = $('.vw-expbox'), items = scopeItems(), n = items.length, stamp = new Date().toISOString().slice(0, 10);
    // live counts next to each choice
    const counts = {view: view.length, sel: baseItems().filter(i => sel.has(i.id)).length, all: baseItems().length, custom: exp.scope === 'custom' ? n : customItems(exp.c).length};
    box.querySelectorAll('.vw-ex-n').forEach(e => { e.textContent = counts[e.dataset.n].toLocaleString() + ' posts'; });
    box.querySelector('.vw-ex-custom').hidden = exp.scope !== 'custom';
    box.querySelectorAll('.vw-ex-scope').forEach(l => l.classList.toggle('on', l.querySelector('input').value === exp.scope));
    const rows = exportRows(items), b = n ? exportBuild(exp.kind, rows, stamp) : null;
    const photos = rows.reduce((t, r) => t + r.photos, 0), videos = rows.reduce((t, r) => t + r.videos, 0), withVid = rows.filter(r => r.videos).length;
    const paths = []; for (const i of items) for (const m of i.media) paths.push(m.url);
    const tok = ++expToken, what = exp.scope === 'view' ? describeView() : exp.scope === 'sel' ? "Posts you ticked" : exp.scope === 'all' ? 'Everything in your library' : describeCustom(exp.c);
    box.querySelector('.vw-ex-summary').innerHTML = n ?
      `<div class="vw-ex-from">${esc(what)}</div><div class="vw-ex-grid"><div><b>${n.toLocaleString()}</b><span>posts</span></div><div><b>${photos.toLocaleString()}</b><span>photos</span></div>` +
      `<div><b>${videos.toLocaleString()}</b><span>videos${withVid ? ' in ' + withVid.toLocaleString() + ' posts' : ''}</span></div>` +
      `<div><b class="vw-ex-media">${opt.fileSizes && paths.length ? 'Calculating…' : paths.length ? 'n/a' : '0 KB'}</b><span>photos and videos in your library</span></div></div>` +
      `<p class="vw-ex-inc"><b>Included:</b> ${exp.kind === 'print' ? 'account, date, caption, like count, how many photos and videos each post has, tags, and a link to the original.' : 'date, account and @handle, caption, like count, location, how many photos and videos each post has, a link to the original on Instagram, your tags and favorite flags.'}</p>` +
      `<p class="vw-ex-note"><b>Not included:</b> the photos and videos themselves. They stay in your library. This export only lists them.</p>` +
      (b ? `<p class="vw-ex-size">File size: about ${fmtSize(new Blob([b.text]).size)}</p>` : '')
      : `<p class="vw-ex-note">No posts match this choice yet. ${exp.scope === 'sel' ? 'Tick some posts first, or pick another option above.' : 'Loosen the rules above.'}</p>`;
    box.querySelector('[data-act=expgo]').disabled = !n;
    if (n && opt.fileSizes && paths.length) {
      Promise.resolve(opt.fileSizes(paths)).then(r => {
        if (tok !== expToken) return;
        const bytes = typeof r === 'number' ? r : r.bytes, el = box.querySelector('.vw-ex-media');
        if (el) el.textContent = (r && r.approx ? 'about ' : '') + fmtSize(bytes);
      }).catch(() => { const el = box.querySelector('.vw-ex-media'); if (el && tok === expToken) el.textContent = 'n/a'; });
    }
  }
  function runExport() {
    const items = scopeItems(); if (!items.length) return;
    const rows = exportRows(items), stamp = new Date().toISOString().slice(0, 10), b = exportBuild(exp.kind, rows, stamp);
    closeExport();
    if (b) download(b.name, b.text, b.type); else printPage(rows);
  }
  $('.vw-expbox').addEventListener('input', e => { if (e.target.closest('.vw-ex-custom')) { readExportForm(); clearTimeout(expTimer); expTimer = setTimeout(updateExportSummary, 200); } });
  $('.vw-expbox').addEventListener('change', e => { readExportForm(); updateExportSummary(); });

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-view],[data-act]'); if (!t) return;
    if (t.dataset.tab) { ui.tab = t.dataset.tab; return refresh(); }
    if (t.dataset.view) { ui.view = t.dataset.view; return refresh(); }
    const act = t.dataset.act, card_ = t.closest('.vw-tw'), id = t.dataset.id || (card_ && card_.dataset.id);
    const i = id ? byId.get(id) : null;
    switch (act) {
      case 'lb': if (i) openLb(i.media.map((m, k) => ({url: m.url, video: m.video, id: i.id, k, removed: m.removed})), +t.dataset.k); break;
      case 'wl': openLb(wall, +t.dataset.n); break;
      case 'lbx': closeLb(); break;
      case 'lbp': stepLb(-1); break;
      case 'lbn': stepLb(1); break;
      case 'post': openPost(id); break;
      case 'mx': closeModal(); break;
      case 'side': side.classList.toggle('open'); break;
      case 'author': ui.author = ui.author === t.dataset.h ? '' : t.dataset.h; side.classList.remove('open'); refresh(); break;
      case 'clrauthor': ui.author = ''; refresh(); break;
      case 'clrtag': ui.tag = ''; refresh(); break;
      case 'tagfilter': ui.tag = ui.tag.toLowerCase() === t.dataset.tag.toLowerCase() ? '' : t.dataset.tag; side.classList.remove('open'); closeModal(); refresh(); break;
      case 'clear': ui = Object.assign(ui, {q: '', media: 'any', from: '', to: '', sort: 'new', author: '', tag: '', showHidden: false, otd: false}); refresh(); break;
      case 'fav': if (state.fav[id]) delete state.fav[id]; else state.fav[id] = 1; saveState(); rerenderCard(id); if (ui.tab === 'fav' && !state.fav[id]) dropFromView(id); break;
      case 'hide':
        if (state.hidden[id]) delete state.hidden[id]; else state.hidden[id] = 1;
        saveState();
        if (state.hidden[id] && !ui.showHidden) dropFromView(id); else rerenderCard(id);
        break;
      case 'tag': {
        const v = prompt('Add a tag (or several, separated by commas):'); if (!v) break;
        const cur = state.tags[id] || [];
        for (const x of v.split(',').map(s => s.trim()).filter(Boolean)) if (!cur.some(c => c.toLowerCase() === x.toLowerCase())) cur.push(x);
        state.tags[id] = cur; saveState(); rerenderCard(id); renderSide(); break;
      }
      case 'rmtag': {
        e.stopPropagation();
        state.tags[id] = (state.tags[id] || []).filter(x => x !== t.dataset.tag);
        if (!state.tags[id].length) delete state.tags[id];
        saveState(); rerenderCard(id); renderSide(); break;
      }
      case 'del': deletePost(id); break;
      case 'qclear': clearTimeout(qTimer); ui.q = ''; ui.author = ''; ui.tag = ''; $('.vw-q').value = ''; refresh(); $('.vw-q').focus(); break;
      case 'otd': ui.otd = !ui.otd; refresh(); break;
      case 'tips': { const t = $('.vw-tips'); t.hidden = !t.hidden; break; }
      case 'filters': { const f = $('.vw-fpanel'); f.hidden = !f.hidden; break; }
      case 'clrmedia': ui.media = 'any'; refresh(); break;
      case 'clrdates': ui.from = ui.to = ''; refresh(); break;
      case 'clrhidden': ui.showHidden = false; refresh(); break;
      case 'clrotd': ui.otd = false; refresh(); break;
      case 'export': { const m = $('.vw-expmenu'); m.hidden = !m.hidden; break; }
      case 'exp-csv': case 'exp-json': case 'exp-print': $('.vw-expmenu').hidden = true; openExport(act.slice(4)); break;
      case 'expk-csv': case 'expk-json': case 'expk-print': exp.kind = act.slice(5); renderExport(); break;
      case 'expgo': runExport(); break;
      case 'expx': closeExport(); break;
      case 'selmode': selectMode = !selectMode; refresh(true); break;
      case 'sel': {
        const checked = t.checked;
        if (e.shiftKey && lastSelId) {
          const a = view.findIndex(i => i.id === lastSelId), b = view.findIndex(i => i.id === id);
          if (a >= 0 && b >= 0) for (let k = Math.min(a, b); k <= Math.max(a, b); k++) { if (checked) sel.add(view[k].id); else sel.delete(view[k].id); }
        } else if (checked) sel.add(id); else sel.delete(id);
        lastSelId = id; saveSel(); syncSelBoxes(); updateSelBar(); break;
      }
      case 'selall': view.forEach(i => sel.add(i.id)); saveSel(); syncSelBoxes(); updateSelBar(); break;
      case 'selclear': sel.clear(); saveSel(); syncSelBoxes(); updateSelBar(); renderChips(); break;
      case 'seldone': selectMode = false; refresh(true); break;
      case 'selexport': openExport(exp.kind, 'sel'); break;
      case 'clrsel': sel.clear(); saveSel(); renderChips(); break;
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.vw-expwrap')) { const m = $('.vw-expmenu'); if (m) m.hidden = true; }
    if (!e.target.closest('.vw-fwrap')) { const f = $('.vw-fpanel'); if (f) f.hidden = true; }
  });
  $('.vw-expd').addEventListener('click', e => { if (e.target === $('.vw-expd')) closeExport(); });
  modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
  lbEl.addEventListener('click', e => { if (e.target === lbEl || e.target === stageEl) closeLb(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('.vw-expd').classList.contains('open')) closeExport(); else if (modalEl.classList.contains('open')) closeModal(); else closeLb(); }
    else if (e.key === 'ArrowRight' && !modalEl.classList.contains('open')) stepLb(1);
    else if (e.key === 'ArrowLeft' && !modalEl.classList.contains('open')) stepLb(-1);
  });

  let qTimer;
  $('.vw-q').addEventListener('input', e => { updateQClear(); clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = e.target.value; refresh(); }, 200); });
  $('.vw-asq').addEventListener('input', renderSide);
  $('.vw-media').onchange = e => { ui.media = e.target.value; refresh(); };
  $('.vw-sort').onchange = e => { ui.sort = e.target.value; refresh(); };
  $('.vw-from').onchange = e => { ui.from = e.target.value; refresh(); };
  $('.vw-to').onchange = e => { ui.to = e.target.value; refresh(); };
  $('.vw-showhid').onchange = e => { ui.showHidden = e.target.checked; refresh(); };

  // ---------- remember my place ----------
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => addEventListener(ev, () => { userMoved = true; }, {passive: true}));
  let scrollTimer;
  addEventListener('scroll', () => {
    if (!ready || ui.view !== 'feed') return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const r = listEl.getBoundingClientRect();
      const el = document.elementFromPoint(Math.min(innerWidth - 5, r.left + 60), 150);
      const c = el && el.closest('.vw-tw.ctx-feed');
      if (c) { ui.anchor = c.dataset.id; saveUi(); }
    }, 250);
  }, {passive: true});
  function restorePlace() {
    const a = ui.anchor;
    if (a && ui.view === 'feed') {
      const idx = view.findIndex(i => i.id === a);
      if (idx > 0) {
        while (shown <= idx && shown < view.length) more();
        const go = () => { if (userMoved) return; const el = listEl.querySelector(`[data-id="${a}"]`); if (el) el.scrollIntoView(); };
        go(); setTimeout(go, 600); setTimeout(go, 1600);
      }
    }
    setTimeout(() => { ready = true; }, 300);
  }

  const stateReady = loadState();
  return {
    getState: () => state,
    mergeSidecars(x) {
      const changed = applySidecars(x);
      if (!changed.length) return;  // nothing new: leave the page alone (no flicker)
      if (ui.view === 'feed') changed.forEach(rerenderCard);
    },
    async setState(x) { Object.assign(state, x || {}); saveState(); buildAuthors(); refresh(true); },
    retryMedia() { root.querySelectorAll('.missing[data-p]').forEach(el => { el.dataset.h = '1'; mio ? mio.observe(el) : loadMedia(el); }); },
    count: () => all.length,
    async set(items) {
      try { await stateReady; } catch (e) {}
      const first = all.length === 0;
      ingest(items);
      refresh(true);
      if (first) restorePlace();
    }
  };
}
