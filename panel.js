// Downloader panel for Instagram Saver.
function pnWhen(ts) {
  if (!ts) return 'never';
  const d = new Date(ts * 1000), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const t = d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}), diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? 'Today, ' + t : diff === 1 ? 'Yesterday, ' + t : d.toLocaleDateString([], {month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric'}) + ', ' + t;
}
function pnLastRunText(s) {  // short text for the status strip, e.g. "Today, 3:14 PM · +12"
  const r = s.last_run;
  if (!r) return 'Not run yet';
  if (r.status === 'running') return 'Running now';
  return pnWhen(r.ended || r.started) + (r.new != null ? ' · +' + r.new.toLocaleString() : '');
}
// initPanel(root, {api: 'api/', mediaBase: 'lib/', onFinished(status), onSidecars()})
function initPanel(root, opt) {
  const api = opt.api || 'api/', mediaBase = opt.mediaBase || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtB = b => b >= 1e12 ? (b / 1e12).toFixed(2) + ' TB' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(0) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
  const fmtT = s => s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : s >= 60 ? Math.floor(s / 60) + ' min' : Math.max(0, Math.round(s)) + ' sec';
  const call = (p, body) => fetch(api + p, body !== undefined ? {method: 'POST', body: JSON.stringify(body)} : undefined)
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; });

  root.innerHTML = `
<div class="pn">
 <div class="pn-tabs" role="tablist"><button class="pn-tab on" data-tab="run">Run</button><button class="pn-tab" data-tab="auto">Automation</button><button class="pn-tab" data-tab="tools">Tools</button></div>

 <section data-sec="run">
  <div class="pn-card pn-acct">
   <div class="pn-acct-sum" hidden><div class="pn-avatar"></div><div class="pn-grow2"><b class="pn-sum-user"></b><div class="pn-small pn-sum-browser"></div></div><span class="pn-chip good">Logged in</span><button class="pn-btn pn-edit">Edit</button></div>
   <div class="pn-acct-form">
    <p class="pn-help">Log in to Instagram in the browser you pick, then enter your username. Instagram only lets you download your own saved posts.</p>
    <div class="pn-row"><label>Username <input class="pn-user" placeholder="yourname" size="14"></label>
     <label>Browser <select class="pn-browser"><option>chrome</option><option>brave</option><option>firefox</option><option>safari</option><option>edge</option></select></label>
     <button class="pn-btn pn-test">Test login</button></div>
    <div class="pn-testres"></div>
   </div>
  </div>

  <div class="pn-card">
   <button class="pn-btn primary pn-big pn-start">Start download</button>
   <button class="pn-btn danger pn-big pn-stop" hidden>Stop</button>
   <div class="pn-chips">
    <label class="pn-tog"><input type="checkbox" class="pn-saved" checked><span>Saved posts</span></label>
    <label class="pn-tog" title="After a full pass has reached the end of your saved posts, later runs stop as soon as they reach posts you already have."><input type="checkbox" class="pn-auto" checked><span>Stop when nothing new</span></label>
   </div>
  </div>

  <div class="pn-card stats">
   <div><span class="k">Saved so far</span><b class="st-posts">–</b> posts · <b class="st-size">–</b></div>
   <div class="run st-run"></div>
   <div class="pn-last"></div>
   <div class="pn-note"></div>
   <div class="pn-outcome"></div>
  </div>

  <details class="pn-det pn-logd" open><summary>Live download log</summary><pre class="pn-log">Waiting…</pre></details>

  <details class="pn-det pn-hist"><summary>Run history</summary><div class="pn-histlist"></div></details>

  <div class="pn-card pn-store">
   <div class="pn-disk"></div>
   <div class="pn-row"><input class="pn-dir" aria-label="Save folder"></div>
   <div class="pn-row"><button class="pn-btn pn-dirbtn">Change folder</button><button class="pn-btn pn-movebtn">Move library…</button></div>
   <div class="pn-move" hidden>
    <b>Move your library to another drive</b>
    <p class="pn-small">Copies everything, checks every file, then switches over. You can't download while it runs. If it's interrupted, start it again and it continues.</p>
    <div class="pn-row"><label class="pn-grow">New folder <input class="pn-movedir" placeholder="/Volumes/MyDrive/instagram"></label></div>
    <div class="pn-row"><label class="pn-small"><input type="checkbox" class="pn-movedel"> Delete the old copy afterwards</label><button class="pn-btn primary pn-movego">Start move</button><button class="pn-btn pn-moveclose">Close</button></div>
    <div class="pn-bar" hidden><div></div></div><div class="pn-movetext pn-small"></div>
   </div>
  </div>

 </section>

 <section data-sec="auto" hidden>
  <div class="pn-card">
   <div class="pn-row"><label>Run automatically <select class="pn-sched"><option value="0">Never</option><option value="60">Every hour</option><option value="180">Every 3 hours</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Every day</option></select></label></div>
   <div class="pn-next pn-small"></div>
   <p class="pn-small">Automatic runs only happen while the app window (the Terminal window that started it) stays open and your Mac is awake.</p>
  </div>
  <div class="pn-card">
   <div class="pn-row"><label><input type="checkbox" class="pn-notify" checked> Show a message box when a download finishes</label><button class="pn-btn pn-ntest">Show example</button></div>
  </div>
  <div class="pn-card">
   <div class="pn-row"><label>Pause downloads when free space drops below <input type="number" min="0" step="1" class="pn-minfree" style="width:70px"> GB</label></div>
  </div>
  <div class="pn-card">
   <div class="pn-row"><label>Limit each run to <input type="number" min="0" step="50" class="pn-maxrun" style="width:80px"> new posts</label></div>
   <p class="pn-small">Instagram flags accounts that download a lot very quickly. When a run reaches this limit it pauses, and the next run (press Start download, or let a scheduled run do it) continues where it stopped. Enter 0 for no limit.</p>
  </div>
 </section>

 <section data-sec="tools" hidden>
  <div class="pn-card pn-alltally"></div>
  <div class="pn-card pn-tool"><div><b>Video previews</b><div class="pn-prev pn-small"></div></div><button class="pn-btn pn-prevgo">Prepare now</button></div>
  <div class="pn-card pn-large">
   <div class="pn-tool"><div><b>Large files</b><div class="pn-lg-sum pn-small">Find your biggest videos and delete them to free space. The posts stay, and the files are never downloaded again.</div></div>
    <span><select class="pn-lg-min"><option value="50">Over 50 MB</option><option value="100" selected>Over 100 MB</option><option value="250">Over 250 MB</option><option value="500">Over 500 MB</option><option value="1000">Over 1 GB</option></select> <button class="pn-btn pn-lg-scan">Scan</button></span></div>
   <div class="pn-lg-total"></div>
   <div class="pn-lg-list"></div>
   <div class="pn-lg-foot" hidden><span class="pn-lg-sel pn-small"></span><span><button class="pn-btn pn-lg-all">Select all shown</button> <button class="pn-btn pn-lg-clear">Clear</button> <button class="pn-btn pn-lg-shrink">Shrink selected…</button> <button class="pn-btn danger pn-lg-del">Delete selected…</button></span></div>
   <div class="pn-shrink" hidden>
    <b>Make the selected videos smaller</b>
    <p class="pn-small">Re-saves each video at a lower resolution. The post, the file name and the download record stay the same, so nothing is downloaded again. The original is replaced, which can't be undone. Use <b>Preview</b> to try a sample first.</p>
    <div class="pn-row"><label>Quality <select class="pn-sh-preset"><option value="720">720p HD (recommended)</option><option value="480">480p (smaller)</option><option value="360">360p (smallest)</option></select></label></div>
    <div class="pn-sh-est pn-small"></div>
    <label class="pn-small"><input type="checkbox" class="pn-sh-keep"> Keep the originals in an "_originals" folder (uses space until you delete that folder)</label>
    <div class="pn-row"><button class="pn-btn primary pn-sh-go">Start shrinking</button><button class="pn-btn pn-sh-cancel">Cancel</button></div>
   </div>
   <div class="pn-sh-run" hidden><div class="pn-bar"><div></div></div><div class="pn-sh-text pn-small"></div><button class="pn-btn danger pn-sh-stop">Stop</button></div>
   <div class="pn-sh-total"></div>
   <div class="pn-lg-res"></div>
  </div>
  <div class="pn-card"><div class="pn-tool"><div><b>Duplicates</b><div class="pn-dup pn-small"></div></div><span><button class="pn-btn pn-dupgo">Find duplicates</button> <button class="pn-btn danger pn-dupfree" hidden>Free up space</button></span></div><div class="pn-dup-total"></div><div class="pn-dupres"></div></div>
 </section>
</div>`;
  const $ = s => root.querySelector(s);
  // Assigning the same text or HTML again makes the browser redraw it. Skip those writes, so the panel doesn't flicker while it polls.
  const quiet = el => {
    const dh = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'), dt = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    const guard = (name, d, k) => Object.defineProperty(el, name, {configurable: true, get() { return d.get.call(this); }, set(v) { const key = k + '\u0000' + v; if (this._q === key) return; this._q = key; d.set.call(this, v); }});
    guard('innerHTML', dh, 'h'); guard('textContent', dt, 't');
  };
  ['.pn-alltally', '.pn-sh-total', '.pn-sh-text', '.pn-dup-total', '.pn-lg-total', '.st-run', '.pn-last', '.pn-histlist', '.pn-disk', '.pn-outcome', '.pn-dupres', '.pn-log', '.pn-note', '.pn-prev', '.pn-dup', '.pn-next', '.pn-movetext', '.st-posts', '.st-size', '.pn-dupfree', '.pn-sum-user', '.pn-sum-browser'].forEach(c => quiet($(c)));
  let lastBad = '', lastAlert = null, moveDismissed = false, lastMovePhase = '', st = null, init = false, wasBusy = false, lastSide = 0, lastDupState = '', prevActive = false;

  const settings = body => call('settings', body).catch(e => alert(e.message));
  $('.pn-sched').onchange = e => settings({schedule_minutes: +e.target.value});
  $('.pn-minfree').onchange = e => settings({min_free_gb: +e.target.value || 0});
  $('.pn-maxrun').onchange = e => settings({max_per_run: +e.target.value || 0});
    $('.pn-notify').onchange = e => settings({notify: e.target.checked});

  // ---------- tabs ----------
  function showTab(name) {
    root.querySelectorAll('.pn-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
    root.querySelectorAll('[data-sec]').forEach(x => { x.hidden = x.dataset.sec !== name; });
  }
  root.querySelectorAll('.pn-tab').forEach(t => { t.onclick = () => showTab(t.dataset.tab); });

  // ---------- account card: collapses to one line once your login has been confirmed ----------
  const cleanUser = () => $('.pn-user').value.trim().replace(/^@/, '');
  function loginKnown() {
    try { const x = JSON.parse(localStorage.getItem('igs-login') || 'null'); return !!(x && x.user && x.user === cleanUser() && x.browser === $('.pn-browser').value); } catch (e) { return false; }
  }
  function syncAcct(forceForm) {
    const ok = !forceForm && loginKnown();
    $('.pn-acct-sum').hidden = !ok; $('.pn-acct-form').hidden = ok;
    if (ok) { $('.pn-sum-user').textContent = '@' + cleanUser(); const b = $('.pn-browser').value; $('.pn-sum-browser').textContent = b.charAt(0).toUpperCase() + b.slice(1); $('.pn-avatar').textContent = cleanUser().charAt(0).toUpperCase(); }
  }
  function markLogin() { try { localStorage.setItem('igs-login', JSON.stringify({user: cleanUser(), browser: $('.pn-browser').value})); } catch (e) {} syncAcct(); }
  $('.pn-edit').onclick = () => syncAcct(true);

  // ---------- message box (styled like the intro tutorial) ----------
  const overlay = document.createElement('div'); overlay.className = 'pn-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="pn-dialog" role="dialog" aria-modal="true"><div class="pn-dico"></div><h2 class="pn-dtitle"></h2><div class="pn-dbody"></div><ol class="pn-dsteps"></ol><div class="pn-dbtns"></div></div>';
  document.body.appendChild(overlay);
  const closeAlert = () => { overlay.hidden = true; };
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAlert(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeAlert(); });
  const STEPS = {
    ok: ['Your library has already been refreshed with the new posts.', 'Press View new posts to see them at the top.', 'The next run is a quick update and stops on its own when nothing is new.'],
    none: ['Nothing to do. Quick updates stop on their own when nothing is new.', 'Want it hands-free? Turn on "Run automatically" in the panel.'],
    login: ['Open instagram.com in the browser you picked and log in.', 'Make sure that same browser is selected in the panel.', 'Press Retry. Your progress is saved.'],
    keychain: ['macOS asked to allow access to your browser login. Choose Allow.', 'Safari also needs Full Disk Access for Terminal.', 'Press Retry.'],
    rate: ['Instagram limits how fast posts can be requested. This is temporary.', 'Wait about an hour, then press Retry.', 'Nothing is lost. It continues where it stopped.'],
    blocked: ['Open instagram.com in the browser you picked and finish any security check it shows.', 'Wait about an hour, then press Retry.', 'Lower "Limit each run" in the Automation tab so it downloads in smaller batches.'],
    capped: ['This is the per-run limit from the Automation tab. It keeps Instagram from flagging your account.', 'Press Retry (or wait for the next scheduled run) to continue where it stopped.', 'Nothing is lost. Your progress is saved.'],
    network: ['Check your internet connection.', 'Press Retry. It continues where it stopped.'],
    disk: ['Free up space on the drive, or use Move library… to a bigger drive.', 'Then press Retry. Your progress is saved.'],
    lowdisk: ['Free up space on the drive, or use Move library… to a bigger drive.', 'Then press Retry. Your progress is saved.'],
    notfound: ['Check the spelling of your Instagram username (no @).', 'Enter it again and press Start download.'],
    error: ['Open the log at the bottom of the panel to see what failed.', 'Press Retry to try the failed items again.'],
    skipped: ['Free up space or reconnect the drive.', 'The next scheduled run will try again.'],
    shrunk: ['The posts look the same, just at a lower resolution.', 'Scan again to see the new sizes.', 'Originals were replaced unless you chose to keep them in the _originals folder.'],
    moved: ['Your library now lives in the new folder.', 'If you kept the old copy, delete it once you are happy.'],
    movefail: ['Nothing was changed. Your library is still where it was.', 'Check the new drive is connected and has enough space, then try again.']
  };
  const SHOW_ADVICE = ['skipped', 'moved', 'movefail', 'shrunk', 'capped'];
  function showAlert(a, example) {
    const good = ['ok', 'none', 'moved', 'shrunk', 'capped'].includes(a.kind);
    overlay.querySelector('.pn-dico').textContent = good ? '✓' : '⚠';
    overlay.querySelector('.pn-dtitle').textContent = (a.kind === 'ok' ? 'Download finished' : a.kind === 'none' ? "You're up to date" : a.title) + (example ? ' (example)' : '');
    let body = '';
    if (a.kind === 'ok') body = `<p><b>${(a.new || 0).toLocaleString()} new post${a.new === 1 ? '' : 's'}</b> saved (${fmtB(a.bytes || 0)} added in ${fmtT(a.seconds || 0)}).</p><p>Your library now has <b>${(a.total || 0).toLocaleString()} posts</b>.</p>`;
    else if (a.kind === 'none') body = '<p>No new posts were found since your last run.</p>';
    else if (a.kind === 'moved') body = `<p>${esc(a.advice)}</p><p>${(a.total || 0).toLocaleString()} posts · ${fmtB(a.bytes || 0)} moved.</p>`;
    else if (SHOW_ADVICE.includes(a.kind)) body = `<p>${esc(a.advice)}</p>`;
    overlay.querySelector('.pn-dbody').innerHTML = body;
    overlay.querySelector('.pn-dsteps').innerHTML = (STEPS[a.kind] || []).map(t => `<li>${esc(t)}</li>`).join('');
    const btns = overlay.querySelector('.pn-dbtns'); btns.innerHTML = '';
    const add = (label, primary, fn) => { const b = document.createElement('button'); b.className = 'pn-btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; btns.appendChild(b); };
    if (a.kind === 'ok') add('View new posts', true, () => { closeAlert(); if (opt.onViewNew) opt.onViewNew(); });
    if (a.retry && !example) add('Retry', true, () => { closeAlert(); start(); });
    add('Close', !(a.kind === 'ok' || (a.retry && !example)), closeAlert);
    overlay.hidden = false;
  }
  $('.pn-ntest').onclick = () => showAlert({kind: 'ok', new: 12, bytes: 340e6, seconds: 185, total: (st ? st.stats.lib.posts : 0) + 12}, true);
  $('.pn-prevgo').onclick = () => call('previews/start', {}).then(poll);

  function startBody() {
    return {user: $('.pn-user').value, browser: $('.pn-browser').value, kinds: ['saved'].filter(k => $('.pn-' + k).checked), auto_stop: $('.pn-auto').checked};
  }
  const start = async () => { try { await call('start', startBody()); wasBusy = true; poll(); } catch (e) { alert(e.message); } };
  $('.pn-start').onclick = start;
  $('.pn-stop').onclick = () => call('stop', {}).catch(() => {});
  $('.pn-dirbtn').onclick = async () => { try { await call('config', {dir: $('.pn-dir').value}); await poll(); if (opt.onFinished) opt.onFinished(st, true); } catch (e) { alert(e.message); } };
  $('.pn-test').onclick = async () => {
    const r = $('.pn-testres'); r.className = 'pn-testres'; r.textContent = 'Checking… macOS may ask to allow access to the browser login. Choose Allow.';
    try { const x = await call('login-check', {user: $('.pn-user').value, browser: $('.pn-browser').value}); r.className = 'pn-testres ' + (x.ok ? 'good' : 'bad'); r.textContent = x.title + (x.advice ? ' ' + x.advice : ''); if (x.ok) markLogin(); }
    catch (e) { r.className = 'pn-testres bad'; r.textContent = e.message; }
  };

  // move library
  $('.pn-movebtn').onclick = () => { $('.pn-move').hidden = false; $('.pn-movedir').focus(); };
  $('.pn-moveclose').onclick = () => { $('.pn-move').hidden = true; moveDismissed = true; };
  $('.pn-movego').onclick = async () => {
    const del = $('.pn-movedel').checked;
    if (del && !confirm('After the copy is checked, the OLD library folder will be deleted to free its space. Only continue if you are sure.')) return;
    try { await call('move', {dir: $('.pn-movedir').value, delete_old: del}); poll(); } catch (e) { alert(e.message); }
  };

  // large files cleaner
  const lg = {files: [], sel: new Set()};
  function lgSummary() {
    const picked = lg.files.filter(f => lg.sel.has(f.path)), bytes = picked.reduce((t, f) => t + f.size, 0);
    $('.pn-lg-sel').textContent = picked.length ? `${picked.length.toLocaleString()} selected · frees ${fmtB(bytes)}` : 'Tick the files you want to delete.';
    $('.pn-lg-del').disabled = !picked.length || !!(st && (st.running || st.move.active));
  }
  function lgRender(r) {
    $('.pn-lg-sum').textContent = r.count ? `${r.count.toLocaleString()} files are over ${$('.pn-lg-min').selectedOptions[0].textContent.replace('Over ', '')} and use ${fmtB(r.bytes)} in total. Showing the largest ${r.shown.toLocaleString()}.` : 'No files that large. Try a smaller size.';
    $('.pn-lg-list').innerHTML = r.files.map(f => `<label class="pn-lg-row"><input type="checkbox" data-p="${esc(f.path)}" ${lg.sel.has(f.path) ? 'checked' : ''}>` +
      (f.thumb ? `<img src="${esc(mediaBase + f.thumb)}" alt="">` : `<span class="pn-lg-ph">${f.video ? 'video' : 'file'}</span>`) +
      `<button class="pn-btn pn-lg-view" type="button" data-v="${esc(f.path)}">Preview</button>` +
      `<span class="pn-lg-info"><b>${esc(fmtB(f.size))}</b> · @${esc(f.handle || '?')} · ${esc(f.date)}${f.dur ? ' · ' + Math.floor(f.dur / 60) + ':' + String(Math.round(f.dur % 60)).padStart(2, '0') : ''}` +
      `<span class="pn-small">${esc(f.text || '(no caption)')}</span>${f.shrunk ? '<span class="pn-small good">Already shrunk</span>' : ''}${f.recorded ? '' : '<span class="pn-small warn">Not in the download record yet. It will be added first, so it can\'t come back.</span>'}</span></label>`).join('');
    $('.pn-lg-foot').hidden = !r.files.length; lgSummary();
  }
  $('.pn-lg-scan').onclick = async () => {
    $('.pn-lg-sum').textContent = 'Scanning your library…'; $('.pn-lg-res').textContent = '';
    try { const r = await call('large', {min_mb: +$('.pn-lg-min').value, limit: 150}); lg.files = r.files; lg.sel.clear(); lgRender(r); } catch (e) { $('.pn-lg-sum').textContent = e.message; }
  };
  // shrink videos
  const SH_RATE = {720: 1.2e6, 480: 0.7e6, 360: 0.4e6}, SH_RATIO = {720: 0.25, 480: 0.14, 360: 0.08};
  function shEstimate() {
    const preset = $('.pn-sh-preset').value, vids = lg.files.filter(f => lg.sel.has(f.path) && f.video && !f.shrunk), other = lg.sel.size - vids.length;
    if (!vids.length) { $('.pn-sh-est').textContent = lg.sel.size ? 'None of the ticked files can be shrunk (only videos that have not been shrunk already).' : 'Tick some videos first.'; return vids; }
    const now = vids.reduce((t, f) => t + f.size, 0), after = vids.reduce((t, f) => t + (f.dur ? Math.min(f.size, f.dur * (SH_RATE[preset] + 96e3) / 8) : f.size * SH_RATIO[preset]), 0);
    $('.pn-sh-est').innerHTML = `<b>${vids.length.toLocaleString()} video${vids.length === 1 ? '' : 's'}</b>: ${fmtB(now)} now → about ${fmtB(after)}, saving roughly <b>${fmtB(now - after)}</b>.` + (other ? ` ${other} ticked file${other === 1 ? ' is' : 's are'} skipped.` : '') + ' A typical estimate. Videos that are already small may not shrink much, and those are left alone.';
    return vids;
  }
  $('.pn-lg-shrink').onclick = () => {
    const box = $('.pn-shrink'); box.hidden = !box.hidden; shEstimate();
    if (!box.hidden) requestAnimationFrame(() => box.scrollIntoView({block: 'center', behavior: 'smooth'}));  // bring the whole options box into view, centered
  };
  $('.pn-sh-cancel').onclick = () => { $('.pn-shrink').hidden = true; };
  $('.pn-sh-preset').onchange = shEstimate;
  $('.pn-sh-go').onclick = async () => {
    const vids = shEstimate(); if (!vids.length) return;
    if (!confirm(`Shrink ${vids.length} video${vids.length === 1 ? '' : 's'} to ${$('.pn-sh-preset').selectedOptions[0].textContent.split(' ')[0]}?\n\n${$('.pn-sh-keep').checked ? 'The originals are kept in an _originals folder.' : 'Each original is replaced by the smaller version and cannot be recovered.'}\nThe posts stay the same and nothing is downloaded again. This can take a while; you can keep using the app.`)) return;
    try { await call('shrink/start', {paths: vids.map(f => f.path), preset: $('.pn-sh-preset').value, keep_originals: $('.pn-sh-keep').checked}); $('.pn-shrink').hidden = true; poll(); } catch (e) { alert(e.message); }
  };
  $('.pn-sh-stop').onclick = () => call('shrink/stop', {}).catch(() => {});

  // small preview window: watch the video and read the whole post before deciding
  const pv = document.createElement('div'); pv.className = 'pn-pv'; pv.hidden = true;
  pv.innerHTML = '<div class="pn-pvbox" role="dialog" aria-modal="true" aria-label="Post preview"></div>';
  document.body.appendChild(pv);
  let pvIdx = -1, pvTok = 0, pvMode = 'large';
  const pvNav = d => pvMode === 'dupes' ? pvGroup(pvIdx + d) : pvOpen(pvIdx + d);
  const pvClose = () => { pv.hidden = true; pvTok++; pv.querySelector('.pn-pvbox').innerHTML = ''; pvIdx = -1; };  // clearing it also stops the video from streaming
  pv.addEventListener('click', e => { if (e.target === pv) pvClose(); });
  document.addEventListener('keydown', e => {
    if (pv.hidden) return;
    if (e.key === 'Escape') { pvClose(); e.stopPropagation(); }
    else if (e.key === 'ArrowRight') pvNav(1);
    else if (e.key === 'ArrowLeft') pvNav(-1);
  }, true);
  async function pvOpen(i) {
    if (i < 0 || i >= lg.files.length) return;
    pvMode = 'large'; pvIdx = i; const f = lg.files[i], tok = ++pvTok, box = pv.querySelector('.pn-pvbox');
    const media = f.video ? `<video class="pn-pvmedia" controls preload="metadata" ${f.thumb ? `poster="${esc(mediaBase + f.thumb)}"` : ''} src="${esc(mediaBase + f.path)}"></video>` : `<img class="pn-pvmedia" src="${esc(mediaBase + f.path)}" alt="">`;
    box.innerHTML = `<div class="pn-pvhd"><b>${esc(fmtB(f.size))}</b> · ${i + 1} of ${lg.files.length}<button class="pn-btn pn-pvx" type="button">Close</button></div>${media}<div class="pn-pvtweet"><span class="pn-small">Loading the post…</span></div>` +
      (f.video && !f.shrunk ? `<div class="pn-pvshrink"><span class="pn-small">Try a smaller version:</span> <select class="pn-pvpreset"><option value="720">720p</option><option value="480">480p</option><option value="360">360p</option></select> <button class="pn-btn pn-pvsample" type="button">Make an 8-second sample</button><div class="pn-pvsres"></div></div>` : '') +
      `<div class="pn-pvbtns"><button class="pn-btn pn-pvprev" type="button" ${i === 0 ? 'disabled' : ''}>‹ Previous</button><label class="pn-pvmark"><input type="checkbox" ${lg.sel.has(f.path) ? 'checked' : ''}> Mark for deletion</label><button class="pn-btn pn-pvnext" type="button" ${i === lg.files.length - 1 ? 'disabled' : ''}>Next ›</button></div>`;
    const sb = box.querySelector('.pn-pvsample');
    if (sb) sb.onclick = async () => {
      const res = box.querySelector('.pn-pvsres'), preset = box.querySelector('.pn-pvpreset').value; sb.disabled = true; res.innerHTML = '<span class="pn-small">Making the sample…</span>';
      try {
        const r = await call('shrink/sample', {path: f.path, preset});
        if (tok !== pvTok) return;
        res.innerHTML = `<video class="pn-pvmedia" controls preload="metadata" src="${esc(mediaBase + r.path)}"></video><div class="pn-small">${preset}p sample · ${fmtB(r.bytes)} for ${Math.round(r.seconds)} seconds` + (r.est_total ? ` · the whole video would be about <b>${fmtB(r.est_total)}</b> (now ${fmtB(r.original)}), saving about <b>${fmtB(Math.max(0, r.original - r.est_total))}</b>` : '') + '</div>';
      } catch (e) { res.innerHTML = `<span class="pn-small bad">${esc(e.message)}</span>`; }
      sb.disabled = false;
    };
    box.querySelector('.pn-pvx').onclick = pvClose;
    box.querySelector('.pn-pvprev').onclick = () => pvOpen(pvIdx - 1);
    box.querySelector('.pn-pvnext').onclick = () => pvOpen(pvIdx + 1);
    box.querySelector('.pn-pvmark input').onchange = e => {
      if (e.target.checked) lg.sel.add(f.path); else lg.sel.delete(f.path);
      const row = $('.pn-lg-list').querySelector(`input[data-p="${CSS.escape(f.path)}"]`); if (row) row.checked = e.target.checked; lgSummary();
    };
    try {
      const d = await call('large/preview', {path: f.path});
      if (tok !== pvTok) return;
      box.querySelector('.pn-pvtweet').innerHTML = `<div><b>${esc(d.author)}</b> <span class="pn-small">@${esc(d.handle)} · ${esc(d.date)}</span></div><div class="pn-pvtext">${esc(d.text || '(no caption)')}</div>` +
        `<div class="pn-small">${d.likes ? '♡ ' + d.likes.toLocaleString() + ' · ' : ''}<a href="${esc(d.link)}" target="_blank" rel="noopener">View on Instagram</a></div>`;
    } catch (e) { if (tok === pvTok) box.querySelector('.pn-pvtweet').innerHTML = `<span class="pn-small bad">${esc(e.message)}</span>`; }
    pv.hidden = false;
  }
  async function pvGroup(i) {  // one duplicate: the shared file, plus every post that uses it
    if (i < 0 || i >= dupGroups.length) return;
    pvMode = 'dupes'; pvIdx = i; const g = dupGroups[i], tok = ++pvTok, box = pv.querySelector('.pn-pvbox'), first = g.files[0];
    const media = /\.(mp4|webm|mov|m4v)$/i.test(first) ? `<video class="pn-pvmedia" controls preload="metadata" src="${esc(mediaBase + first)}"></video>` : `<img class="pn-pvmedia" src="${esc(mediaBase + first)}" alt="">`;
    box.innerHTML = `<div class="pn-pvhd"><span><b>${g.files.length} identical copies</b> · ${fmtB(g.size)} each<div class="pn-small">Group ${i + 1} of ${dupGroups.length} · deleting the extras frees ${fmtB(g.size * (g.files.length - 1))}</div></span><button class="pn-btn pn-pvx" type="button">Close</button></div>${media}` +
      `<div class="pn-pvcopies"><span class="pn-small">Loading the posts…</span></div>` +
      `<div class="pn-pvbtns"><button class="pn-btn pn-pvprev" type="button" ${i === 0 ? 'disabled' : ''}>‹ Previous group</button><span class="pn-small">One copy is kept, the rest are deleted.</span><button class="pn-btn pn-pvnext" type="button" ${i === dupGroups.length - 1 ? 'disabled' : ''}>Next group ›</button></div>`;
    box.querySelector('.pn-pvx').onclick = pvClose;
    box.querySelector('.pn-pvprev').onclick = () => pvGroup(pvIdx - 1);
    box.querySelector('.pn-pvnext').onclick = () => pvGroup(pvIdx + 1);
    pv.hidden = false;
    const details = await Promise.all(g.files.map(f => call('large/preview', {path: f}).catch(() => null)));
    if (tok !== pvTok) return;
    box.querySelector('.pn-pvcopies').innerHTML = details.map((d, k) => !d ? `<div class="pn-pvcopy"><span class="pn-small bad">${esc(g.files[k])} could not be read.</span></div>` :
      `<div class="pn-pvcopy"><span class="pn-dtag ${k === 0 ? 'keep' : 'rm'}">${k === 0 ? 'Kept' : 'Deleted'}</span> <b>${esc(d.author)}</b> <span class="pn-small">@${esc(d.handle)} · ${esc(d.date.slice(0, 10))}</span>` +
      `<div class="pn-pvtext">${esc(d.text || '(no caption)')}</div><div class="pn-small">${d.likes ? '♡ ' + d.likes.toLocaleString() + ' · ' : ''}<a href="${esc(d.link)}" target="_blank" rel="noopener">View on Instagram</a></div></div>`).join('');
  }
  $('.pn-dupres').addEventListener('click', e => { const b = e.target.closest('.pn-dg-view'); if (b) pvGroup(+b.dataset.g); });
  $('.pn-lg-list').addEventListener('click', e => { const b = e.target.closest('.pn-lg-view'); if (!b) return; e.preventDefault(); pvOpen(lg.files.findIndex(f => f.path === b.dataset.v)); });
  $('.pn-lg-list').addEventListener('change', e => { const c = e.target.closest('input[data-p]'); if (!c) return; if (c.checked) lg.sel.add(c.dataset.p); else lg.sel.delete(c.dataset.p); lgSummary(); });
  $('.pn-lg-all').onclick = () => { lg.files.forEach(f => lg.sel.add(f.path)); $('.pn-lg-list').querySelectorAll('input').forEach(c => { c.checked = true; }); lgSummary(); };
  $('.pn-lg-clear').onclick = () => { lg.sel.clear(); $('.pn-lg-list').querySelectorAll('input').forEach(c => { c.checked = false; }); lgSummary(); };
  $('.pn-lg-del').onclick = async () => {
    pvClose();
    const picked = lg.files.filter(f => lg.sel.has(f.path)), bytes = picked.reduce((t, f) => t + f.size, 0), n = picked.length;
    if (!n || !confirm(`Delete ${n.toLocaleString()} file${n === 1 ? '' : 's'} (${fmtB(bytes)}) from your drive?\n\nThe posts and their captions stay in your library. The files can't be recovered, and they won't be downloaded again.`)) return;
    $('.pn-lg-del').disabled = true; $('.pn-lg-res').className = 'pn-lg-res pn-small'; $('.pn-lg-res').textContent = 'Deleting…';
    try {
      const r = await call('large/remove', {paths: picked.map(f => f.path)});
      $('.pn-lg-res').className = 'pn-lg-res ' + (r.failed.length ? 'bad' : 'good');
      $('.pn-lg-res').innerHTML = `Freed <b>${fmtB(r.freed)}</b> from ${r.removed.toLocaleString()} file${r.removed === 1 ? '' : 's'}.` +  (r.record_added ? ` ${r.record_added} were added to the download record first.` : '') +
        '' +
        (r.failed.length ? `<div class="pn-small bad">${r.failed.length} kept: ${esc(r.failed[0].why)}</div>` : '');
      if (opt.onSidecars) opt.onSidecars();
      if (opt.onFinished) opt.onFinished(st, true);
      poll();
      const sc = await call('large', {min_mb: +$('.pn-lg-min').value, limit: 150}); lg.files = sc.files; lg.sel.clear(); lgRender(sc);
    } catch (e) { $('.pn-lg-res').className = 'pn-lg-res bad'; $('.pn-lg-res').textContent = e.message; lgSummary(); }
  };

  // duplicates
  $('.pn-dupgo').onclick = () => call('dupes/scan', {}).then(poll);
  $('.pn-dupfree').onclick = async () => {
    if (!confirm('Keep one copy of each duplicate file and delete the extra copies?\n\nThe posts keep working: they point to the remaining copy. This can\'t be undone.')) return;
    try { const r = await call('dupes/apply', {}); $('.pn-dupres').innerHTML = `<div class="pn-good">Freed ${fmtB(r.freed)}.</div>`; if (opt.onSidecars) opt.onSidecars(); poll(); } catch (e) { alert(e.message); }
  };
  let dupGroups = [];
  async function showDupes() {
    const d = await call('dupes'), box = $('.pn-dupres');
    if (!d.groups.length) { box.innerHTML = ''; return; }
    dupGroups = d.groups;
    box.innerHTML = d.groups.map((g, gi) => `<div class="pn-dg"><span>${g.files.length} copies · ${fmtB(g.size)} each<span class="pn-small"> · frees ${fmtB(g.size * (g.files.length - 1))}</span></span>` +
      (/\.(jpe?g|png|webp|gif)$/i.test(g.files[0]) ? `<img src="${esc(mediaBase + g.files[0])}" alt="">` : '<em>video</em>') + `<button class="pn-btn pn-dg-view" type="button" data-g="${gi}">Preview</button></div>`).join('');
  }

  function render(s) {
    st = s;
    if (!init) {
      init = true;
      $('.pn-user').value = s.user || ''; $('.pn-browser').value = s.browser || 'chrome'; $('.pn-dir').value = s.dir;
      $('.pn-saved').checked = s.kinds.includes('saved'); $('.pn-auto').checked = s.auto_stop !== false;
      syncAcct();
      $('.pn-sched').value = String(s.schedule_minutes || 0); $('.pn-notify').checked = s.notify !== false; $('.pn-minfree').value = s.min_free_gb; $('.pn-maxrun').value = s.max_per_run;
    }
    const l = s.stats.lib, r = s.stats.run, busy = s.running || s.refreshing || s.move.active;
    $('.st-posts').textContent = l.posts.toLocaleString(); $('.st-size').textContent = fmtB(l.bytes);
    $('.st-run').innerHTML = r ? `<span class="k">${r.active ? 'This session (live)' : 'Last session'}</span><b>+${r.posts.toLocaleString()}</b> new posts · <b>${fmtB(r.bytes)}</b> added · ${fmtT(r.seconds)}`
      : '<span class="k">This session</span><b>+0</b> new posts · <b>0 KB</b> added · not started';
    const KIND = {ok: 'Finished', none: 'Up to date', capped: 'Paused at limit', stopped: 'Stopped', interrupted: 'Interrupted', skipped: 'Skipped', unknown: ''};
    const label = o => !o ? '' : (o.kind in KIND ? KIND[o.kind] : 'Needed attention');
    const lr = s.last_run;
    $('.pn-last').innerHTML = lr ? `<span class="k">Last run</span>${esc(pnWhen(lr.ended || lr.started))}` +
      (lr.status === 'running' ? ' · running now' : (label(lr.outcome) ? ' · ' + label(lr.outcome) : '')) +
      (lr.new != null && lr.status !== 'running' ? ` · <b>+${lr.new.toLocaleString()}</b> new · ${fmtB(lr.bytes || 0)}` : '') +
      (lr.status === 'inferred' ? ' <span class="pn-small">(recorded before history was kept)</span>' : '')
      : '<span class="k">Last run</span>none yet';
    $('.pn-histlist').innerHTML = (s.history || []).map(r => {
      const modes = [...new Set(Object.values(r.modes || {}))].map(m => `<span class="pn-tag">${m === 'quick' ? 'quick update' : 'full scan'}</span>`).join('');
      return `<div class="pn-hrow"><div><b>${esc(pnWhen(r.started))}</b> ${r.scheduled ? '<span class="pn-tag">scheduled</span>' : ''}${modes}</div>` +
        `<div class="pn-small ${r.outcome && ['ok', 'none', 'stopped', 'capped'].includes(r.outcome.kind) ? '' : 'bad'}">${esc(label(r.outcome) || 'Running…')}${r.status === 'running' ? ' (running now)' : ''} · +${(r.new || 0).toLocaleString()} new · ${fmtB(r.bytes || 0)} · ${fmtT(r.seconds || 0)}</div></div>`;
    }).join('') || '<div class="pn-small">No runs recorded yet. Each run you do from now on is saved here.</div>';
    $('.pn-note').textContent = s.running ? (s.note || '') : '';
    const o = s.outcome, oc = $('.pn-outcome');
    if (s.running) oc.innerHTML = '';
    else if (s.refreshing) oc.textContent = 'Updating your library view…';
    else if (o) { oc.innerHTML = `<b class="${['ok', 'none', 'stopped', 'capped'].includes(o.kind) ? 'good' : 'bad'}">${esc(o.title)}</b>` + (o.advice ? `<div class="pn-small">${esc(o.advice)}</div>` : '') + (o.retry ? '<button class="pn-btn primary pn-retry">Retry</button>' : ''); const b = oc.querySelector('.pn-retry'); if (b) b.onclick = start; }
    else oc.textContent = '';
    const d = s.disk;
    const cls = d ? (d.low ? 'low' : d.free < d.min * 3 ? 'warn' : '') : '';
    $('.pn-disk').innerHTML = d ? `<div class="pn-free" title="${d.purgeable > 1e9 ? `This matches System Settings > Storage. It includes ${fmtB(d.purgeable)} that macOS frees on its own when it needs room (old Time Machine snapshots and caches). The drive's raw free space is ${fmtB(d.raw_free)}.` : 'This is the free space macOS reports for this drive.'}"><b class="${cls}">${fmtB(d.free)} free</b><span class="pn-small">of ${fmtB(d.total)}${d.purgeable > 1e9 ? ` · includes ${fmtB(d.purgeable)} macOS frees on its own` : ''}${d.low ? ' · below your minimum, downloads are paused' : d.free < d.min * 3 ? ' · getting low' : ''}</span></div><div class="pn-dbar" title="Green: free ${fmtB(d.free)} · Red: used ${fmtB(d.total - d.free)}"><div class="free" style="width:${Math.max(0, Math.min(100, 100 * d.free / d.total)).toFixed(1)}%"></div><div class="used" style="width:${Math.max(0, Math.min(100, 100 * (1 - d.free / d.total))).toFixed(1)}%"></div></div>` : '';
    $('.pn-dirbtn').disabled = busy; $('.pn-movebtn').disabled = s.running; $('.pn-start').hidden = s.running; $('.pn-stop').hidden = !s.running; $('.pn-start').disabled = s.move.active;
    if (!s.available) $('.pn-disk').innerHTML = '<span class="pn-small bad">This drive is not connected.</span>';
    // schedule
    $('.pn-next').textContent = s.schedule_minutes ? (s.running ? 'Running now.' : 'Next automatic run: ' + new Date(s.next_run * 1000).toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'})) : '';
    // move progress
    const mv = s.move, bar = $('.pn-bar'), mt = $('.pn-movetext');
    if (mv.phase !== lastMovePhase && (mv.phase === 'counting')) moveDismissed = false;
    lastMovePhase = mv.phase;
    if (mv.phase && !moveDismissed) {
      $('.pn-move').hidden = false; bar.hidden = false;
      const pct = mv.total_bytes ? 100 * mv.done_bytes / mv.total_bytes : 0; bar.firstElementChild.style.width = pct.toFixed(1) + '%';
      const eta = mv.speed > 0 ? (mv.total_bytes - mv.done_bytes) / mv.speed : null;
      mt.className = 'pn-movetext pn-small' + (mv.phase === 'error' ? ' bad' : mv.phase === 'done' ? ' good' : '');
      mt.textContent = mv.phase === 'counting' ? 'Counting files…' : mv.phase === 'copying' ? `Copying… ${pct.toFixed(1)}% · ${fmtB(mv.done_bytes)} of ${fmtB(mv.total_bytes)} · ${(mv.speed / 1e6).toFixed(1)} MB/s${eta != null ? ' · about ' + fmtT(eta) + ' left' : ''}`
        : mv.phase === 'verifying' ? 'Checking every file…' : mv.phase === 'cleaning' ? 'Removing the old copy…' : mv.phase === 'done' ? mv.message : 'Move failed: ' + mv.error;
      $('.pn-movego').disabled = mv.active;
    }
    // tools
    const pv = s.previews;
    $('.pn-prev').textContent = !s.ffmpeg ? 'Needs ffmpeg (installs automatically on the next start).' : pv.active ? `Preparing… ${pv.done.toLocaleString()} of ${pv.total.toLocaleString()}` : pv.error ? pv.error : 'Up to date.';
    $('.pn-prevgo').disabled = pv.active || !s.ffmpeg;
    const dp = s.dupes;
    $('.pn-dup').textContent = dp.active ? (dp.phase === 'listing' ? 'Listing files…' : `Comparing ${dp.done.toLocaleString()} of ${dp.total.toLocaleString()} files…`) : dp.applied ? `Freed ${fmtB(dp.applied)}.` : dp.phase === 'done' ? (dp.groups ? `${dp.groups.toLocaleString()} groups of duplicates · ${fmtB(dp.wasted)} can be freed` : 'No duplicates found.') : '';
    $('.pn-dupgo').disabled = dp.active; $('.pn-dupfree').hidden = !(dp.groups > 0 && !dp.active); $('.pn-dupfree').textContent = 'Free up ' + fmtB(dp.wasted);
    const key = dp.phase + dp.groups + dp.active; if (key !== lastDupState) { lastDupState = key; if (dp.groups && !dp.active) showDupes().catch(() => {}); else if (!dp.groups) $('.pn-dupres').innerHTML = dp.applied ? $('.pn-dupres').innerHTML : ''; }
    if (s.log.length) { const lg = $('.pn-log'), stick = lg.scrollHeight - lg.scrollTop - lg.clientHeight < 40, txt = s.log.join('\n'); if (lg.textContent !== txt) { lg.textContent = txt; if (stick) lg.scrollTop = lg.scrollHeight; } }
    // events other parts of the page care about
    const al = s.alert;
    if (lastAlert === null) lastAlert = al ? al.id : 0;  // ignore anything from before this page was opened
    else if (al && al.id > lastAlert) { lastAlert = al.id; if (s.notify) showAlert(al); }
    const nowBusy = s.running || s.refreshing || mv.active;
    if (wasBusy && !nowBusy && s.outcome && ['ok', 'none'].includes(s.outcome.kind)) markLogin();
    const bad = s.outcome && !['ok', 'none', 'stopped', 'capped'].includes(s.outcome.kind) ? s.outcome.title : '';
    if (bad && bad !== lastBad) $('.pn-logd').open = true;
    lastBad = bad;
    if (wasBusy && !nowBusy && opt.onFinished) opt.onFinished(s, false);
    wasBusy = nowBusy;
    const side = pv.active;
    if (opt.onSidecars && ((prevActive && !pv.active) || (side && Date.now() - lastSide > 60000))) { lastSide = Date.now(); opt.onSidecars(); }
    prevActive = pv.active;
    const sh = s.shrink, run = $('.pn-sh-run');
    if (sh) {
      run.hidden = !sh.active;
      if (sh.active) {
        const pct = sh.total ? 100 * (sh.done + sh.pct / 100) / sh.total : 0;
        run.querySelector('.pn-bar').hidden = false; run.querySelector('.pn-bar div').style.width = pct.toFixed(1) + '%';
        $('.pn-sh-text').textContent = `Shrinking ${Math.min(sh.done + 1, sh.total)} of ${sh.total}: ${sh.current.split('/').pop()} · ${Math.round(sh.pct)}% · saved so far ${fmtB(sh.saved)}`;
      }
      $('.pn-lg-shrink').disabled = !!sh.active || s.running || (s.move && s.move.active);
    }
    const st2 = s.shrunk;
    $('.pn-sh-total').innerHTML = st2 && st2.files ? `<span class="k">Saved by shrinking</span><b>${fmtB(st2.bytes)}</b> from ${st2.files.toLocaleString()} video${st2.files === 1 ? '' : 's'} · since ${esc(pnWhen(st2.first))}` : '<span class="k">Saved by shrinking</span><span class="pn-small">nothing yet</span>';
    const dc = s.dupes_cleaned;
    $('.pn-dup-total').innerHTML = dc && dc.files ? `<span class="k">Freed with this tool</span><b>${fmtB(dc.bytes)}</b> from ${dc.files.toLocaleString()} duplicate file${dc.files === 1 ? '' : 's'} removed${dc.estimated ? ' (estimated from earlier cleanups)' : ` · since ${esc(pnWhen(dc.first))}`}` : '<span class="k">Freed with this tool</span><span class="pn-small">nothing yet</span>';
    const cl = s.cleaned;
    $('.pn-lg-total').innerHTML = cl && cl.files ? `<span class="k">Freed with this tool</span><b>${fmtB(cl.bytes)}</b> from ${cl.files.toLocaleString()} file${cl.files === 1 ? '' : 's'} · since ${esc(pnWhen(cl.first))}` : '<span class="k">Freed with this tool</span><span class="pn-small">nothing yet</span>';
    const tot = (cl ? cl.bytes : 0) + (dc ? dc.bytes : 0) + (st2 ? st2.bytes : 0);
    $('.pn-alltally').innerHTML = `<div class="pn-at-head"><span class="pn-small">Space freed with these tools</span><b>${fmtB(tot)}</b></div><div class="pn-small">Large files deleted ${fmtB(cl ? cl.bytes : 0)} · Duplicates removed ${fmtB(dc ? dc.bytes : 0)} · Videos shrunk ${fmtB(st2 ? st2.bytes : 0)}</div>`;
    lgSummary();
    if (opt.onStatus) opt.onStatus(s);
  }
  async function poll() { try { render(await call('status')); } catch (e) {} }
  poll(); setInterval(poll, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('focus', poll);
  return {poll, status: () => st, start, showTab};
}
