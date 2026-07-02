// 上传证件照 → GPT-5 色彩分析 → 3 条色带（同一人多色）→ 拼成可下载的色彩测试海报
const $ = (id) => document.getElementById(id);
const state = { image: null, editImage: null, analysis: null, gender: '' };
const show = (id) => $(id).classList.remove('hidden');
function progress(m) { const p = $('progress'); p.classList.remove('hidden'); p.innerHTML = m; }
async function post(path, body) {
  const r = await fetch(path.replace(/^\//, ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d;
}

const drop = $('drop');
$('file').onchange = (e) => e.target.files[0] && handleFile(e.target.files[0]);
['dragover', 'dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
}));
async function handleFile(file) {
  $('dropText').textContent = '读取中…';
  try {
    const { thumbURL, editURL } = await ColorCV.fromFile(file, $('work'));
    state.image = thumbURL; state.editImage = editURL;
    $('thumb').src = thumbURL; show('thumbWrap');
    $('dropText').textContent = '已选择 · 可重新上传';
  } catch { $('dropText').textContent = '读取失败，换一张试试'; }
}

$('btnStart').onclick = run;
async function run() {
  if (!state.image) { progress('请先上传一张照片'); return; }
  const btn = $('btnStart'); btn.disabled = true;
  try {
    progress('<span class="spinner"></span> 正在分析你的色彩…');
    const a = await post('/api/coloranalysis', { image: state.image });
    state.analysis = a; state.gender = $('pGender').value || '女';
    renderAnalysis(a); show('result');

    progress('<span class="spinner"></span> 正在生成色带（同一张脸穿不同颜色，约 1 分钟）…');
    const rows = [['rowRec', a.recommend, '✓ 推荐色'], ['rowNeu', a.neutral, '一般色'], ['rowAvo', a.avoid, '✕ 避免色']];
    state.strips = {};
    await Promise.all(rows.map(([id, colors]) => makeStrip(id, colors)));
    progress('✅ 完成！可点下方「保存为图片」。');
    window.CSDAuth?.saveHistory({ type: 'color', title: a.season || '色彩测试', thumb: state.image,
      payload: a, images: Object.values(state.strips || {}) });
  } catch (e) { progress(`<span class="err" style="display:inline-block">出错了：${e.message}</span>`); }
  finally { btn.disabled = false; }
}

function renderAnalysis(a) {
  $('toneBox').innerHTML = `<span class="tone-label">肤色基调</span><b>${a.skin_tone || '—'}</b>`
    + `<span class="tone-sep">·</span><span class="tone-label">季型</span><b>${a.season || '—'}</b>`;
  const mk = a.makeup || {};
  const item = (k, label) => mk[k] ? `<div class="mk-item"><span class="mk-sw" style="background:${mk[k].hex || '#ccc'}"></span>
    <div><b>${label}</b><span>${mk[k].desc || ''}</span></div></div>` : '';
  $('makeup').innerHTML = `<div class="mk-title">妆容建议</div><div class="mk-grid">
    ${item('eye', '眼妆')}${item('blush', '腮红')}${item('lip', '唇色')}${item('brow', '眉型')}</div>`;
  $('summary').textContent = a.summary || '';
  // 先放占位行（带颜色标签），色带图回来后插入
  for (const [id, colors] of [['rowRec', a.recommend], ['rowNeu', a.neutral], ['rowAvo', a.avoid]]) {
    $(id).innerHTML = `<div class="prow-title" data-t></div>
      <div class="strip-box"><div class="strip-loading"><span class="spinner"></span>生成中…</div></div>
      <div class="strip-labels">${(colors || []).map((c) => `<span><i style="background:${c.hex}"></i>${c.name}</span>`).join('')}</div>`;
  }
  setTitle();
}
function setTitle() {
  const map = { rowRec: '✓ 推荐色', rowNeu: '一般色', rowAvo: '✕ 避免色' };
  for (const id in map) { const el = $(id).querySelector('.prow-title'); if (el) el.textContent = map[id]; }
}

async function makeStrip(rowId, colors) {
  const box = $(rowId).querySelector('.strip-box');
  try {
    const d = await post('/api/strip', { image: state.editImage, gender: state.gender, colors });
    (state.strips = state.strips || {})[rowId] = d.url;
    const img = new Image(); img.src = d.url; img.alt = '色带'; img.crossOrigin = 'anonymous';
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    box.innerHTML = ''; box.appendChild(img);
  } catch (e) { box.innerHTML = `<div class="err">该行生成失败，可重试</div>`; }
}

// 下载为图片
$('btnDownload').onclick = async () => {
  const btn = $('btnDownload'); btn.disabled = true; btn.textContent = '生成图片中…';
  try {
    const canvas = await html2canvas($('poster'), { scale: 2, useCORS: true, backgroundColor: '#fbf7f1' });
    const a = document.createElement('a');
    a.download = '我的色彩测试.png'; a.href = canvas.toDataURL('image/png'); a.click();
  } catch (e) { alert('保存失败：' + e.message); }
  finally { btn.disabled = false; btn.textContent = '⬇ 保存为图片'; }
};
