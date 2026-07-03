// StyleLab 统一 App：引导建档 → 首页 → 测色/穿搭/形象 → 我的(历史)。全部走真实后端。
const $ = (id) => document.getElementById(id);
const phone = $('phone');
const APP_SCREENS = new Set(['home', 'color', 'outfit', 'lab', 'me']);
const SS = 'stylelab_state';
const state = { thumb: null, editImage: null, analysis: null, profile: {}, token: localStorage.getItem('csd_token') || '', user: null, hist: [], histFilter: '', qc: null };

// ── 工具 ────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const h = { 'Content-Type': 'application/json' }; if (state.token) h['x-token'] = state.token;
  const r = await fetch(path.replace(/^\//, ''), { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d;
}
// 生图失败自动重试（上游偶发 502/超时；成功但连接断的会命中缓存秒回）
async function genRetry(path, body, tries = 3, onRetry) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await api(path, 'POST', body); }
    catch (e) { last = e; if (i < tries - 1) { if (onRetry) onRetry(i + 1); await new Promise((r) => setTimeout(r, 2500 * (i + 1))); } }
  }
  throw last;
}
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function goTo(s) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.dataset.screen === s));
  phone.classList.toggle('app-mode', APP_SCREENS.has(s));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === s));
  $('app').scrollTo({ top: 0, behavior: 'smooth' });
}
const cn = (u) => ({ cool: '冷调', warm: '暖调', neutral: '中性' })[u] || u || '—';
const need = () => { if (!state.editImage) { toast('请先在首页上传照片建档'); goTo(state.analysis ? 'home' : 'welcome'); return false; } return true; };
// 用户知识库：每次生图注入，锁定性别/身形/肤色，防止性别生成错误
function buildSubject() {
  state.subject = { gender: state.profile.gender || (state.analysis?.gender === '男' ? '男' : '女'), build: state.profile.build || '', skin_tone: state.analysis?.skin_tone || '' };
}
function saveSS() { try { sessionStorage.setItem(SS, JSON.stringify({ thumb: state.thumb, editImage: state.editImage, analysis: state.analysis, profile: state.profile })); } catch {} }

// ── 导航绑定 ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]'); if (go) return goTo(go.dataset.go);
  const tab = e.target.closest('[data-tab]'); if (tab) return openTab(tab.dataset.tab);
});
function openTab(s) {
  if (['color', 'outfit', 'lab', 'me'].includes(s) && !state.analysis && !state.editImage && s !== 'me') { toast('先上传照片建档～'); return goTo('welcome'); }
  goTo(s);
  if (s === 'me') renderMe();
  if (s === 'home') renderHome();
}

// ── 认证 ────────────────────────────────────────────────
function openAuth() { $('authModal').classList.remove('hidden'); $('mErr').textContent = ''; }
let authMode = 'login';
$('mTabLogin').onclick = () => { authMode = 'login'; $('mTabLogin').classList.add('on'); $('mTabReg').classList.remove('on'); $('mOk').textContent = '登录'; };
$('mTabReg').onclick = () => { authMode = 'register'; $('mTabReg').classList.add('on'); $('mTabLogin').classList.remove('on'); $('mOk').textContent = '注册'; };
$('mCancel').onclick = () => $('authModal').classList.add('hidden');
$('mOk').onclick = async () => {
  try {
    const d = await api('/api/auth/' + authMode, 'POST', { username: $('mUser').value, password: $('mPass').value });
    state.token = d.token; state.user = d.username; localStorage.setItem('csd_token', d.token);
    $('authModal').classList.add('hidden'); updateAuthUI(); toast('欢迎，' + d.username);
    refreshCurrent();
  } catch (e) { $('mErr').textContent = e.message; }
};
$('welcomeAuth').onclick = openAuth; $('welcomeLogin').onclick = openAuth;
$('meAuth').onclick = () => { if (!state.user) openAuth(); };
$('meLogout').onclick = async () => { try { await api('/api/auth/logout', 'POST'); } catch {} state.token = ''; state.user = null; localStorage.removeItem('csd_token'); updateAuthUI(); renderMe(); toast('已退出'); };
function updateAuthUI() {
  $('welcomeAuth').textContent = state.user || '登录';
  $('meAuth').textContent = state.user || '未登录';
  $('meSub').textContent = state.user ? ('已登录 · ' + state.user) : '登录后可长期保存历史';
}
async function saveHistory(entry) { if (!state.token) return; try { await api('/api/history', 'POST', entry); toast('已存入历史'); } catch {} }
// 数据采集（已同意时）——把照片+测色结果匿名贡献给评测集
async function contribute(a) {
  try {
    const r = await api('/api/contribute', 'POST', { consent: true, image: state.thumb,
      analysis: { season: a.season, undertone: a.undertone, value: a.value, chroma: a.chroma, skin_tone: a.skin_tone, gender: a.gender },
      qc: state.qc ? { wb_conf: state.qc.wb_conf, verdict: state.qc.verdict } : null });
    const ids = JSON.parse(localStorage.getItem('csd_contrib') || '[]'); ids.push(r.id); localStorage.setItem('csd_contrib', JSON.stringify(ids));
    toast('感谢贡献，可在「我的」随时撤回');
  } catch {}
}
function renderContrib() {
  const el = $('contribBox'); if (!el) return;
  const ids = JSON.parse(localStorage.getItem('csd_contrib') || '[]');
  if (!ids.length && !state.token) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card pad" style="font-size:13px;color:var(--muted)">你已贡献 <b style="color:var(--ink)">${ids.length}</b> 张照片用于改进模型（<a href="privacy.html" target="_blank">隐私说明</a>）。${(ids.length || state.token) ? ` · <a href="#" id="revoke" style="color:#c0392b">撤回并删除</a>` : ''}</div>`;
  const rv = $('revoke');
  if (rv) rv.onclick = async (e) => {
    e.preventDefault(); if (!confirm('撤回并删除你贡献过的照片与记录？')) return;
    try { const r = await api('/api/contribute/revoke', 'POST', { ids, all: !!state.token }); localStorage.removeItem('csd_contrib'); toast('已删除 ' + r.removed + ' 条'); renderContrib(); }
    catch (err) { toast(err.message); }
  };
}
// 登录/退出后刷新当前屏（修复：登录后历史不显示）
function refreshCurrent() {
  const a = document.querySelector('.screen.active'); const s = a && a.dataset.screen;
  if (s === 'me') renderMe(); else if (s === 'home') renderHome();
}

// ── 拍照 / 上传 + 质量门 + A4 白平衡 ─────────────────────
$('camBtn').onclick = () => { if (!window.ColorCam) return toast('当前环境不支持相机，请用上传'); ColorCam.open((c) => ingest(c)); };
$('uploadBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); ingest(c); };
  img.onerror = () => toast('读取失败，换一张试试');
  img.src = URL.createObjectURL(f);
};
async function ingest(srcCanvas) {
  const srcW = srcCanvas.width, srcH = srcCanvas.height;
  const max = 900, sc = Math.min(1, max / Math.max(srcW, srcH));
  let work = document.createElement('canvas'); work.width = Math.round(srcW * sc); work.height = Math.round(srcH * sc);
  work.getContext('2d').drawImage(srcCanvas, 0, 0, work.width, work.height);
  let wbValid = false, wbNote = '';
  if ($('a4Ref').checked && window.ColorQC) {
    const patch = ColorQC.findWhitePatch(work);
    if (patch) { const r = ColorQC.whiteBalance(work, patch); wbNote = r.note; if (r.valid) { work = r.canvas; wbValid = true; } }
    else wbNote = '没找到合格的白纸区域（白纸要够大够亮、在画面里）';
  }
  const qc = window.ColorQC ? ColorQC.assess(work, { srcW, srcH, wbRefValid: wbValid }) : null;
  state.qc = qc;
  const { thumbURL, editURL } = await ColorCV.fromCanvas(work, $('work'));
  state.thumb = thumbURL; state.editImage = editURL;
  $('thumb').src = thumbURL; show('capPreview');
  if (qc) renderQC(qc, wbNote); else toast('照片已就绪');
}
function renderQC(qc, wbNote) {
  const el = $('qcOut'); el.classList.remove('hidden');
  const color = qc.verdict === 'good' ? 'var(--green-deep)' : qc.verdict === 'edge' ? '#b7791f' : '#c0392b';
  const label = qc.verdict === 'good' ? '质量良好 ✓' : qc.verdict === 'edge' ? '质量一般（结论会更保守）' : '质量偏低，建议重拍';
  el.innerHTML = `<div style="font-weight:600;color:${color}">${label} · 置信度 ${Math.round(qc.wb_conf * 100)}%</div>
    <div class="qc-gates">${qc.gates.map((g) => `<span class="${g.ok ? 'ok' : 'no'}">${g.ok ? '✓' : '✗'} ${g.name}</span>`).join('')}</div>
    ${wbNote ? `<div class="qc-note">A4：${wbNote}</div>` : ''}
    ${qc.reshoot.length ? `<div class="qc-note">建议：${qc.reshoot.slice(0, 2).join('；')}</div>` : ''}`;
}
$('startAnalyze').onclick = async () => {
  if (!state.editImage) { toast('请先上传照片'); return; }
  state.profile = { gender: $('pGender').value || '', build: $('pBuild').value || '', height: $('pHeight').value, weight: $('pWeight').value };
  goTo('loading'); animateSteps();
  try {
    const a = await api('/api/coloranalysis', 'POST', { image: state.thumb, qc: state.qc ? { wb_conf: state.qc.wb_conf, verdict: state.qc.verdict } : null });
    state.analysis = a;
    // 性别：优先用户所填，否则用 AI 看图判断（修复男性被默认成女的生图错误）
    if (!state.profile.gender) state.profile.gender = a.gender === '男' ? '男' : '女';
    buildSubject();
    renderReport(); saveSS();
    goTo('report');
    saveHistory({ type: 'color', title: a.season || '测色档案', thumb: state.thumb, payload: a, images: [] });
    if ($('consent') && $('consent').checked) contribute(a);
  } catch (e) { toast('分析失败：' + e.message); goTo('upload'); }
};
function animateSteps() {
  const steps = [...document.querySelectorAll('.analysis-steps .step')]; let i = 0;
  steps.forEach((s, k) => s.classList.toggle('active', k === 0));
  const t = setInterval(() => { if (!document.querySelector('[data-screen="loading"]').classList.contains('active')) return clearInterval(t); i = (i + 1) % steps.length; steps.forEach((s, k) => s.classList.toggle('active', k === i)); }, 700);
}

// ── 渲染：档案/报告 ─────────────────────────────────────
const sw = (h, cls = '') => `<div class="swatch"><i style="background:${h}"></i><span>${cls || ''}</span></div>`;
function profileCardHTML(a) {
  const conf = Math.round((a.confidence ?? 0.7) * 100);
  return `<div class="summary-top"><div><h2>${a.season || '—'}</h2>
    <p>肤色基调 ${a.skin_tone || '—'} · ${a.summary || ''}</p></div>
    <div style="text-align:center;flex:0 0 auto"><div class="big-score">${conf}%</div><div style="font-size:10px;color:var(--muted);margin-top:3px">置信度</div></div></div>
    <div class="palette" style="margin-top:12px">${(a.recommend || []).slice(0, 6).map((c) => `<div class="swatch"><i style="background:${c.hex}"></i><span>${c.name}</span></div>`).join('')}</div>`;
}
function renderReport() {
  const a = state.analysis; const mk = a.makeup || {};
  const mkItem = (k, l) => mk[k] ? `<div class="chip-row" style="margin:6px 0"><i style="background:${mk[k].hex || '#ccc'}"></i><b style="color:var(--ink)">${l}</b>${mk[k].desc || ''}</div>` : '';
  $('reportBody').innerHTML = `
    <article class="card report-summary">${profileCardHTML(a)}</article>
    <div class="section-title"><h2>推荐色</h2></div><div class="palette">${(a.recommend || []).map((c) => `<div class="swatch"><i style="background:${c.hex}"></i><span>${c.name}</span></div>`).join('')}</div>
    <div class="section-title"><h2>避免色</h2></div><div class="palette">${(a.avoid || []).map((c) => `<div class="swatch"><i style="background:${c.hex}"></i><span>${c.name}</span></div>`).join('')}</div>
    <div class="section-title"><h2>妆容建议</h2></div><div class="card pad">${mkItem('eye', '眼妆')}${mkItem('blush', '腮红')}${mkItem('lip', '唇色')}${mkItem('brow', '眉型')}</div>`;
}

// ── 首页 ────────────────────────────────────────────────
async function renderHome() {
  $('hiName').textContent = state.user ? '你好，' + state.user : '你好';
  $('homeSeason').textContent = state.analysis?.season?.split(' ')[0] || '未建档';
  $('homeProfile').innerHTML = state.analysis ? profileCardHTML(state.analysis)
    : `<div class="summary-top"><div><h2>还没有档案</h2><p>上传一张照片，AI 帮你测色建档。</p></div><div class="big-score">?</div></div>`;
  if (!state.analysis) $('homeProfile').onclick = () => goTo('welcome');
  await renderHistInto('homeHist', 'homeHistCount', 3);
}
const TL = { color: '色彩测试', outfit: '穿搭造型', pattern: '花纹', haircolor: '发色', hairstyle: '发型', makeup: '妆容', jewelry: '首饰' };
const fmtTs = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
async function loadHist() { try { const { items } = await api('/api/history'); state.hist = items || []; } catch { state.hist = []; } return state.hist; }
function histRow(e, clickable) {
  const img = (e.images && e.images[0]) || e.thumb || '';
  return `<div class="hist-row" ${clickable ? `data-hid="${e.id}" style="cursor:pointer"` : ''}>${img ? `<img src="${img}">` : ''}<div><div class="h-t"><span class="htag">${TL[e.type] || e.type}</span>${e.title || ''}</div>
    <div class="h-m">${fmtTs(e.ts)}${clickable ? ' · 详情 ›' : ''}</div></div></div>`;
}
function wireHist(el) { el.querySelectorAll('[data-hid]').forEach((b) => { b.onclick = () => openHistDetail(b.dataset.hid); }); }

// 首页最近 3 条
async function renderHistInto(elId, countId, limit) {
  const el = $(elId);
  if (!state.token) { el.innerHTML = `<div class="card pad" style="color:var(--muted);font-size:13px">登录后可长期保存并查看历史。<a href="#" id="hl">去登录</a></div>`; const l = $('hl'); if (l) l.onclick = (e) => { e.preventDefault(); openAuth(); }; if ($(countId)) $(countId).textContent = ''; return; }
  await loadHist();
  if ($(countId)) $(countId).textContent = state.hist.length + ' 条';
  const list = limit ? state.hist.slice(0, limit) : state.hist;
  el.innerHTML = list.length ? list.map((e) => histRow(e, true)).join('') : `<div class="card pad" style="color:var(--muted);font-size:13px">还没有记录，去做个测试吧～</div>`;
  wireHist(el);
}
// 我的：按类型汇总 + 可筛选 + 点击详情
function renderHistUI() {
  const el = $('meHist'); const items = state.hist;
  if (!items.length) { el.innerHTML = `<div class="card pad" style="color:var(--muted);font-size:13px">还没有记录，去做个测试吧～</div>`; return; }
  const counts = {}; items.forEach((e) => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const chip = (v, label, n, on) => `<button class="tag ${on ? 'active' : ''}" data-hf="${v}">${label} ${n}</button>`;
  const chips = `<div class="tag-group" style="margin:0 0 12px">${chip('', '全部', items.length, !state.histFilter)}${Object.keys(counts).map((t) => chip(t, TL[t] || t, counts[t], state.histFilter === t)).join('')}</div>`;
  const filtered = state.histFilter ? items.filter((e) => e.type === state.histFilter) : items;
  el.innerHTML = chips + filtered.map((e) => histRow(e, true)).join('');
  el.querySelectorAll('[data-hf]').forEach((b) => { b.onclick = () => { state.histFilter = b.dataset.hf; renderHistUI(); }; });
  wireHist(el);
}
// 历史详情
function openHistDetail(id) {
  const e = (state.hist || []).find((x) => x.id === id); if (!e) return;
  const pl = e.payload || {};
  const imgs = (e.images || []).map((u) => `<img src="${u}" style="width:100%;border-radius:10px;margin-bottom:8px">`).join('');
  const pal = (arr) => `<div class="palette" style="margin-bottom:8px">${arr.map((c) => `<div class="swatch"><i style="background:${c.hex}"></i><span>${c.name}</span></div>`).join('')}</div>`;
  let body = '';
  if (e.type === 'color' && pl.season) {
    body = `<div class="chip-row" style="margin-bottom:8px">季型 <b style="color:var(--ink)">${pl.season}</b> · ${pl.skin_tone || ''}</div>`
      + (pl.recommend ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px">推荐色</div>${pal(pl.recommend)}` : '')
      + (pl.avoid ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px">避免色</div>${pal(pl.avoid)}` : '')
      + `<p style="font-size:13px;color:var(--muted)">${pl.summary || ''}</p>`;
  } else if (e.type === 'outfit' && pl.looks) {
    body = pl.looks.map((lk) => `<div style="margin-bottom:10px"><b>${lk.title || ''}</b>
      <div class="chip-row" style="margin:4px 0">${(lk.colors || []).map((c) => `<span style="display:inline-flex;align-items:center;gap:4px"><i style="background:${c.hex}"></i>${c.name}</span>`).join('')}</div>
      <p style="font-size:12px;color:var(--muted);margin:0">${lk.analysis || ''}</p></div>`).join('');
  } else if (e.type === 'makeup' && pl.picks) {
    body = pl.picks.map((pk) => `<div style="margin-bottom:8px"><b>${pk.name}</b> <span style="font-size:12px;color:var(--muted)">${pk.vibe || ''}</span><p style="font-size:12px;color:var(--muted);margin:2px 0 0">${pk.why || ''}</p></div>`).join('');
  } else if (pl.options) {
    body = `<div class="chip-row" style="flex-wrap:wrap">${pl.options.map((o) => `<span style="display:inline-flex;align-items:center;gap:4px">${o.hex ? `<i style="background:${o.hex}"></i>` : ''}${o.name}</span>`).join('')}</div>`;
  }
  $('histDetail').innerHTML = `<div class="section-title" style="margin:0 0 8px"><h3>${TL[e.type] || e.type}</h3><span>${fmtTs(e.ts)}</span></div>
    <div style="font-weight:600;margin-bottom:10px">${e.title || ''}</div>${imgs}${body}
    <button class="btn text" id="histDel" style="color:#c0392b;margin-top:6px">删除这条记录</button>`;
  $('histModal').classList.remove('hidden');
  $('histDel').onclick = async () => { if (!confirm('删除这条记录？')) return; try { await api('/api/history?id=' + id, 'DELETE'); } catch {} state.hist = state.hist.filter((x) => x.id !== id); $('histModal').classList.add('hidden'); renderHistUI(); toast('已删除'); };
}
$('histClose').onclick = () => $('histModal').classList.add('hidden');

// ── 我的 ────────────────────────────────────────────────
async function renderMe() {
  updateAuthUI();
  $('meProfile').innerHTML = state.analysis ? profileCardHTML(state.analysis)
    : `<div class="summary-top"><div><h2>未建档</h2><p>上传照片测色后，这里显示你的形象档案。</p></div><div class="big-score">?</div></div>`;
  renderContrib();
  const el = $('meHist');
  if (!state.token) { el.innerHTML = `<div class="card pad" style="color:var(--muted);font-size:13px">登录后可长期保存并查看历史。<a href="#" id="hl2">去登录</a></div>`; const l = $('hl2'); if (l) l.onclick = (e) => { e.preventDefault(); openAuth(); }; $('meHistCount').textContent = ''; return; }
  await loadHist();
  $('meHistCount').textContent = state.hist.length + ' 条';
  renderHistUI();
}
$('meReupload').onclick = () => goTo('upload');

// ── 色彩测试（复用建档分析 → 3 条色带）───────────────────
$('runColor').onclick = async () => {
  if (!need()) return;
  if (!state.analysis) { toast('正在读取档案…'); try { state.analysis = await api('/api/coloranalysis', 'POST', { image: state.thumb }); } catch (e) { return toast(e.message); } }
  const a = state.analysis; const btn = $('runColor'); btn.disabled = true;
  const rows = [['推荐色', a.recommend], ['一般色', a.neutral], ['避免色', a.avoid]];
  $('colorResult').innerHTML = `<div class="card pad" id="colorPoster">
    <div class="summary-top" style="margin-bottom:10px"><div><h2 style="margin:0;font-size:19px">个人色彩分析</h2>
      <p style="margin:2px 0 0;color:var(--muted);font-size:12px">肤色 ${a.skin_tone} · ${a.season}</p></div></div>
    ${rows.map(([t], i) => `<div class="section-title" style="margin:14px 0 6px"><h3>${t}</h3></div>
      <div class="strip-box" id="cstrip${i}"><span class="mini-spin"></span></div>
      <div class="strip-labels">${rows[i][1].map((c) => `<span><i style="background:${c.hex}"></i>${c.name}</span>`).join('')}</div>`).join('')}</div>`;
  const prog = $('colorProg'); let done = 0; prog.innerHTML = `<span class="mini-spin"></span> 生成色带 0/3…`;
  const urls = [];
  await Promise.all(rows.map(async ([, colors], i) => {
    try { const d = await genRetry('/api/strip', { image: state.editImage, gender: state.profile.gender || '女', colors, subject: state.subject }, 3, () => { $('cstrip' + i).innerHTML = `<span class="mini-spin"></span> 重试中…`; });
      urls[i] = d.url; $('cstrip' + i).innerHTML = `<img src="${d.url}">`; }
    catch { $('cstrip' + i).innerHTML = `<span style="color:#c0392b;font-size:12px">失败</span>`; }
    done++; prog.innerHTML = done < 3 ? `<span class="mini-spin"></span> 生成色带 ${done}/3…` : '✅ 完成';
  }));
  btn.disabled = false; btn.textContent = '重新生成';
  saveHistory({ type: 'color', title: a.season || '色彩测试', thumb: state.thumb, payload: a, images: urls.filter(Boolean) });
};

// ── 穿搭造型（成套 look：预览图 + 配色 + 点评）─────────────
$('runOutfit').onclick = async () => {
  if (!need() || !state.analysis) { if (!state.analysis) toast('请先建档'); return; }
  const a = state.analysis; const btn = $('runOutfit'); btn.disabled = true;
  const palette = (a.recommend || []).map((c) => c.hex);
  const prog = $('outfitProg'); prog.innerHTML = `<span class="mini-spin"></span> 正在构思造型…`;
  try {
    const o = await api('/api/outfit', 'POST', { season: a.season, palette, profile: state.profile });
    const looks = (o.looks || []).slice(0, 3);
    $('outfitResult').innerHTML = looks.map((lk, i) => `<div class="card pad" style="margin-bottom:14px">
      <div class="section-title" style="margin:0 0 8px"><h3>${lk.title || ('造型 ' + (i + 1))}</h3></div>
      <div class="strip-box" id="olk${i}" style="min-height:220px"><span class="mini-spin"></span></div>
      <div class="chip-row" style="margin:8px 0">${(lk.colors || []).map((c) => `<span style="display:inline-flex;align-items:center;gap:5px"><i style="background:${c.hex}"></i>${c.name}</span>`).join('')}</div>
      <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.6">${lk.analysis || ''}</p></div>`).join('');
    let done = 0; prog.innerHTML = `<span class="mini-spin"></span> 生成上身预览 0/${looks.length}…`;
    const urls = [];
    await Promise.all(looks.map(async (lk, i) => {
      const cols = (lk.colors || []).map((c) => c.hex);
      try { const d = await genRetry('/api/preview', { image: state.editImage, outfit: lk.garments, palette: cols.length ? cols : palette, subject: state.subject, season: a.season, atmos: true }, 3, () => { $('olk' + i).innerHTML = `<span class="mini-spin"></span> 重试中…`; }); urls[i] = d.url; $('olk' + i).innerHTML = `<img src="${d.url}">`; }
      catch { $('olk' + i).innerHTML = `<span style="color:#c0392b;font-size:12px">预览生成失败</span>`; }
      done++; prog.innerHTML = done < looks.length ? `<span class="mini-spin"></span> 生成上身预览 ${done}/${looks.length}…` : '✅ 完成';
    }));
    saveHistory({ type: 'outfit', title: (a.season || '穿搭造型'), thumb: state.thumb, payload: { looks }, images: urls.filter(Boolean) });
  } catch (e) { prog.innerHTML = `<span style="color:#c0392b">出错：${e.message}</span>`; }
  btn.disabled = false; btn.textContent = '重新生成造型';
};

// ── 形象测试 ────────────────────────────────────────────
const LAB = [{ k: 'pattern', l: '🧵 花纹' }, { k: 'haircolor', l: '🎨 发色' }, { k: 'hairstyle', l: '💇 发型' }, { k: 'makeup', l: '💄 妆容' }, { k: 'jewelry', l: '💍 首饰' }];
function renderLabBtns() {
  $('labBtns').innerHTML = LAB.map((t) => `<button class="tag" data-lab="${t.k}">${t.l}</button>`).join('');
  document.querySelectorAll('[data-lab]').forEach((b) => { b.onclick = () => runLab(b.dataset.lab, b.textContent); });
}
async function runLab(key, label) {
  if (!need()) return;
  const secId = 'lab-' + key; let sec = $(secId);
  if (!sec) { sec = document.createElement('div'); sec.id = secId; $('labResults').prepend(sec); }
  if (key === 'makeup') return makeupFlow(sec, label);
  sec.innerHTML = `<div class="card pad"><div class="section-title" style="margin:0 0 8px"><h3>${label}</h3></div><div class="chip-row"><span class="mini-spin"></span> 分析并生成中…</div></div>`;
  try {
    const a = await api('/api/suggest', 'POST', { image: state.thumb, type: key, gender: state.profile.gender || '女' });
    sec.innerHTML = `<div class="card pad"><div class="section-title" style="margin:0 0 6px"><h3>${a.title || label}</h3></div>
      <p style="color:var(--muted);font-size:13px;margin:0 0 10px">${a.intro || ''}</p>
      <div class="strip-box" id="lstrip-${key}"><span class="mini-spin"></span></div>
      <div class="strip-labels">${(a.options || []).map((c) => `<span>${c.hex ? `<i style="background:${c.hex}"></i>` : ''}${c.name}</span>`).join('')}</div></div>`;
    try {
      const d = await genRetry('/api/varystrip', { image: state.editImage, type: key, gender: state.profile.gender || '女', options: a.options, subject: state.subject }, 3, () => { $('lstrip-' + key).innerHTML = `<span class="mini-spin"></span> 重试中…`; });
      $('lstrip-' + key).innerHTML = `<img src="${d.url}">`;
      saveHistory({ type: key, title: a.title || label, thumb: state.thumb, payload: { options: a.options }, images: [d.url] });
    } catch { $('lstrip-' + key).innerHTML = `<span style="color:#c0392b;font-size:12px">生成失败，可重试</span>`; }
  } catch (e) { sec.innerHTML = `<div class="card pad"><div class="err">${e.message}</div></div>`; }
}

// 妆容：氛围感人像（在本人脸上生成 3 种氛围妆）
async function makeupFlow(sec, label) {
  sec.innerHTML = `<div class="card pad"><div class="section-title" style="margin:0 0 8px"><h3>${label}</h3></div><div class="chip-row"><span class="mini-spin"></span> 挑选适合你的氛围妆…</div></div>`;
  try {
    const g = state.profile.gender || '女';
    const { picks } = await api('/api/makeup', 'POST', { image: state.thumb, gender: g });
    sec.innerHTML = `<div class="card pad"><div class="section-title" style="margin:0 0 6px"><h3>${label}</h3></div>
      <p style="color:var(--muted);font-size:12px;margin:0 0 10px">AI 为你挑了 ${picks.length} 种氛围妆，直接上到你本人脸上（自然通透，非浓妆）。</p>
      ${picks.map((p, i) => `<div style="margin-bottom:12px">
        <div class="chip-row" style="margin-bottom:6px"><b style="color:var(--ink)">${p.name}</b><span style="font-size:12px">${p.vibe}</span></div>
        <div class="strip-box" id="mk${i}" style="min-height:220px"><span class="mini-spin"></span></div>
        <p style="margin:6px 0 0;color:var(--muted);font-size:12px">${p.why || ''}</p></div>`).join('')}</div>`;
    const urls = [];
    await Promise.all(picks.map(async (p, i) => {
      try { const d = await genRetry('/api/portrait', { image: state.editImage, desc: p.desc, subject: state.subject, season: state.analysis?.season, atmos: true }, 3, () => { $('mk' + i).innerHTML = `<span class="mini-spin"></span> 重试中…`; }); urls[i] = d.url; $('mk' + i).innerHTML = `<img src="${d.url}">`; }
      catch { $('mk' + i).innerHTML = `<span style="color:#c0392b;font-size:12px">生成失败，可重试</span>`; }
    }));
    saveHistory({ type: 'makeup', title: '氛围妆 · ' + picks.map((p) => p.name).join('/'), thumb: state.thumb, payload: { picks }, images: urls.filter(Boolean) });
  } catch (e) { sec.innerHTML = `<div class="card pad"><div class="err">${e.message}</div></div>`; }
}

// ── 初始化 ──────────────────────────────────────────────
(function init() {
  // 支持 ?t=token 登录链接（用后即从地址栏抹掉）
  const tp = new URLSearchParams(location.search).get('t');
  if (tp) { state.token = tp; localStorage.setItem('csd_token', tp); history.replaceState(null, '', location.pathname + location.hash); }
  // 恢复本次会话的照片/档案
  try { const s = JSON.parse(sessionStorage.getItem(SS) || 'null'); if (s && s.editImage) { Object.assign(state, s); if (s.analysis) buildSubject(); } } catch {}
  renderLabBtns();
  // 时钟
  const setClock = () => { const d = new Date(); $('clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };
  try { setClock(); } catch {}
  // 恢复登录态
  if (state.token) api('/api/auth/me').then((d) => { state.user = d.username; updateAuthUI(); }).catch(() => { state.token = ''; localStorage.removeItem('csd_token'); });
  updateAuthUI();
  // 已有档案 → 直接进首页
  if (state.analysis) { renderReport(); renderHome(); goTo('home'); }
  // 支持 #screen 深链（也便于分享/回跳）
  const h = location.hash.slice(1);
  if (h && document.querySelector(`[data-screen="${h}"]`)) { goTo(h); if (h === 'home') renderHome(); if (h === 'me') renderMe(); }
  // 深链到某条历史详情：#d=<id>
  const dm = h.match(/^d=(.+)$/);
  if (dm) { goTo('me'); renderMe().then(() => openHistDetail(dm[1])); }
})();
