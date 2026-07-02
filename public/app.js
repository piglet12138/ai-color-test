// 一键流程：上传 + 选项 → 测色 → 搭配 → 三套上身试穿（并行）。带临时本地缓存（sessionStorage）。
const $ = (id) => document.getElementById(id);
const state = { features: null, image: null, editImage: null, season: null, palette: [], profile: {}, outfits: [] };
const CACHE_KEY = 'csd_run_v1';

function setStep(n) {
  document.querySelectorAll('.steps li').forEach((li) => {
    const s = +li.dataset.step;
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
}
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
async function post(path, body) {
  const r = await fetch(path.replace(/^\//, ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const cn = (u) => ({ cool: '冷调', warm: '暖调', neutral: '中性' })[u] || u || '—';
function progress(msg) { const p = $('progress'); p.classList.remove('hidden'); p.innerHTML = msg; }

// ── 上传 ────────────────────────────────────────────────
const drop = $('drop');
$('file').onchange = (e) => e.target.files[0] && handleFile(e.target.files[0]);
['dragover', 'dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
}));
async function handleFile(file) {
  $('dropText').textContent = '读取中…';
  try {
    const { features, thumbURL, editURL } = await ColorCV.fromFile(file, $('work'));
    state.features = features; state.image = thumbURL; state.editImage = editURL;
    $('thumb').src = thumbURL; show('thumbWrap');
    $('dropText').textContent = '已选择 · 可重新上传';
  } catch (err) { $('dropText').textContent = '读取失败，换一张试试'; }
}

function currentProfile() {
  return {
    gender: $('pGender').value || state.profile.gender || '不确定',
    height: $('pHeight').value, weight: $('pWeight').value,
    build: $('pBuild').value || state.profile.build || '不确定',
  };
}

// ── 一键流程 ────────────────────────────────────────────
$('btnStart').onclick = runAll;
async function runAll() {
  if (!state.image) { progress('请先上传一张照片'); return; }
  const btn = $('btnStart'); btn.disabled = true;
  hide('restoredBar');
  try {
    // ① 测色
    progress('<span class="spinner"></span> ① 正在分析你的颜色…'); setStep(1);
    const d = await post('/api/diagnose', { features: state.features, image: state.image, note: $('note').value });
    state.season = d.season; state.palette = d.palette || []; state.profile = d.profile || {};
    renderDiagnosis(d); show('r1');

    // ② 搭配
    progress('<span class="spinner"></span> ② 正在为你搭配…'); setStep(2);
    const o = await post('/api/outfit', { season: state.season, palette: state.palette, profile: currentProfile(), occasion: $('occasion').value, budget: $('budget').value });
    state.outfits = o.outfits || [];
    renderOutfits(state.outfits); show('r2'); show('r3');

    // ③ 三套上身试穿（并行）
    setStep(3);
    let done = 0; const n = state.outfits.length;
    progress(`<span class="spinner"></span> ③ 正在生成上身试穿（0/${n}，每套约 1-2 分钟）…`);
    await Promise.all(state.outfits.map((_, i) => genSlot(i).then(() => {
      done++; progress(done < n ? `<span class="spinner"></span> ③ 正在生成上身试穿（${done}/${n}）…` : `✅ 全部完成！共 ${n} 套上身效果。`);
    })));
    saveCache();
    window.CSDAuth?.saveHistory({ type: 'outfit', title: state.season || '穿搭试穿', thumb: state.image,
      payload: { report: state._diag, outfits: state.outfits }, images: state.outfits.map((o) => o._tryon).filter(Boolean) });
  } catch (e) {
    progress(`<span class="err" style="display:inline-block">出错了：${e.message}</span>`);
  } finally { btn.disabled = false; }
}

// ── 渲染：报告 ──────────────────────────────────────────
function renderDiagnosis(d) {
  const m = d.metrics || {};
  const sw = (h, cls = '') => `<div class="sw ${cls}" style="background:${h}"><span class="hex">${h}</span></div>`;
  const v = d.observed || d._vision;
  const visionBlock = v ? `
    <div class="vision-box">
      <div class="lab">AI 看到的你</div>
      <div class="vchips">
        ${v.skin_hex ? `<span><i style="background:${v.skin_hex}"></i>肤色 ${v.skin_desc || ''}</span>` : ''}
        ${v.hair_hex ? `<span><i style="background:${v.hair_hex}"></i>发色 ${v.hair_desc || ''}</span>` : ''}
        ${v.eye_hex ? `<span><i style="background:${v.eye_hex}"></i>瞳色 ${v.eye_desc || ''}</span>` : ''}
      </div>
      ${d.profile ? `<div class="vmeta">${[d.profile.gender, d.profile.age_range ? d.profile.age_range + '岁' : '', d.profile.build && d.profile.build !== '不确定' ? '体型' + d.profile.build : '', d.profile.hair_style].filter(Boolean).join(' · ')}</div>` : ''}
    </div>` : '';
  $('diagOut').innerHTML = visionBlock + `
    <div class="season-head"><span class="name">${d.season || '—'}</span>
      <span class="conf">匹配度 ${Math.round((d.confidence ?? 0) * 100)}%</span></div>
    <div class="metrics">
      <span>季型：${d.season_4 || '—'}</span><span>冷暖：${cn(d.undertone)}</span>
      <span>明度：${m.value || '—'}</span><span>纯度：${m.chroma || '—'}</span><span>对比：${m.contrast || '—'}</span></div>
    <div class="reason">${d.reasoning || ''}</div>
    <div class="palette-row"><div class="lab">你的专属色板</div><div class="swatches">${(d.palette || []).map((h) => sw(h)).join('')}</div></div>
    ${(d.avoid || []).length ? `<div class="palette-row"><div class="lab">不太适合</div><div class="swatches">${d.avoid.map((h) => sw(h, 'avoid')).join('')}</div></div>` : ''}
    ${(d.tips || []).length ? `<div class="tips"><div class="lab">给你的建议</div><ul>${d.tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>` : ''}`;
}

// ── 渲染：搭配 + 试穿画廊骨架 ───────────────────────────
function renderOutfits(outfits) {
  $('outfitOut').innerHTML = outfits.map((o) => {
    const items = (o.items || []).map((it) => `
      <div class="item"><span class="chip" style="background:${it.hex || '#ccc'}"></span>
        <span class="cat">${it.category || ''}</span><span>${it.desc || ''}</span>
        ${it.price ? `<span class="price">¥${it.price}</span>` : ''}</div>`).join('');
    const total = o.total_price || (o.items || []).reduce((s, it) => s + (+it.price || 0), 0);
    return `<div class="outfit"><h3>${o.title || '方案'} <span class="occ">${o.occasion || ''}</span></h3>
      <div class="items">${items}</div><div class="why">${o.why || ''}</div>
      <div class="total">合计约 ¥${total}</div></div>`;
  }).join('');
  $('previewOut').innerHTML = `<div class="tryon-grid">${outfits.map((o, i) => `
    <div class="tryon-cell" id="slot${i}"><div class="t-title">${o.title || '方案 ' + (i + 1)}</div>
      <div class="t-body"><div class="t-loading"><span class="spinner"></span>排队中…</div></div></div>`).join('')}</div>`;
}

// ── 上身试穿（单格；并行调用，互不覆盖）─────────────────
async function genSlot(i) {
  const cell = $('slot' + i); if (!cell || cell.dataset.busy) return;
  cell.dataset.busy = '1';
  const o = state.outfits[i];
  const desc = (o.items || []).map((it) => it.desc).join('，');
  cell.querySelector('.t-body').innerHTML = '<div class="t-loading"><span class="spinner"></span>生成中…</div>';
  try {
    const d = await post('/api/preview', { outfit: desc, palette: state.palette, image: state.editImage });
    o._tryon = d.url; // 记入 state 以便缓存
    cell.querySelector('.t-body').innerHTML = `
      <div class="preview-wrap"><img src="${d.url}" alt="${o.title}"><span class="fidelity">👤 你本人换装</span></div>
      <button class="ghost t-btn" data-idx="${i}">重新生成</button>`;
    cell.querySelector('.t-btn').onclick = () => { delete o._tryon; genSlot(i).then(saveCache); };
  } catch (e) {
    cell.querySelector('.t-body').innerHTML = `<div class="err">生成失败，可重试</div><button class="ghost t-btn" data-idx="${i}">重试</button>`;
    cell.querySelector('.t-btn').onclick = () => genSlot(i).then(saveCache);
  } finally { delete cell.dataset.busy; }
}

// ── 临时本地缓存（sessionStorage，刷新不丢；标签关闭即清）─────────
function saveCache() {
  try {
    const payload = { ts: Date.now(), thumb: state.image, season: state.season, palette: state.palette,
      profile: state.profile, diag: state._diag, outfits: state.outfits };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}
function restoreCache() {
  let c; try { c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch {}
  if (!c || !c.diag) return;
  state.season = c.season; state.palette = c.palette; state.profile = c.profile || {}; state.outfits = c.outfits || [];
  state.image = c.thumb;
  if (c.thumb) { $('thumb').src = c.thumb; show('thumbWrap'); }
  renderDiagnosis(c.diag); show('r1');
  renderOutfits(state.outfits); show('r2'); show('r3');
  state.outfits.forEach((o, i) => {
    if (o._tryon) {
      const cell = $('slot' + i);
      cell.querySelector('.t-body').innerHTML = `<div class="preview-wrap"><img src="${o._tryon}" alt="${o.title}"><span class="fidelity">👤 你本人换装</span></div>
        <button class="ghost t-btn" data-idx="${i}">重新生成</button>`;
      cell.querySelector('.t-btn').onclick = () => { delete o._tryon; genSlot(i).then(saveCache); };
    }
  });
  setStep(3);
  const bar = $('restoredBar'); bar.classList.remove('hidden');
  bar.innerHTML = `已恢复上次的结果（本地缓存）。<a href="#" id="clearCache">清除并重新开始</a>`;
  $('clearCache').onclick = (e) => { e.preventDefault(); sessionStorage.removeItem(CACHE_KEY); location.reload(); };
}
// 记录完整诊断对象以便缓存渲染
const _rd = renderDiagnosis;
renderDiagnosis = function (d) { state._diag = d; return _rd(d); };

restoreCache();
