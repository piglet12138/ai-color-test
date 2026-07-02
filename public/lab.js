// AI 形象测试实验室：上传一次 → 花纹/发色/发型/妆容(女)/首饰(女) 各出一张"同一人多变体"图
const $ = (id) => document.getElementById(id);
const state = { image: null, editImage: null, gender: '女' };
const show = (id) => $(id).classList.remove('hidden');
async function post(path, body) {
  const r = await fetch(path.replace(/^\//, ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d;
}
const TESTS = [
  { key: 'pattern', label: '🧵 花纹测试' },
  { key: 'haircolor', label: '🎨 发色测试' },
  { key: 'hairstyle', label: '💇 发型测试' },
  { key: 'makeup', label: '💄 妆容测试' },
  { key: 'jewelry', label: '💍 首饰测试' },
];

// 上传
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

$('pGender').onchange = () => { state.gender = $('pGender').value; renderButtons(); };
function renderButtons() {
  $('testBtns').innerHTML = TESTS.map((t) => `<button class="test-btn" data-key="${t.key}">${t.label}</button>`).join('');
  document.querySelectorAll('.test-btn').forEach((b) => { b.onclick = () => runTest(b.dataset.key); });
}
renderButtons();

async function runTest(key) {
  if (!state.image) { alert('请先上传一张照片'); return; }
  const test = TESTS.find((t) => t.key === key);
  const secId = 'sec-' + key;
  let sec = $(secId);
  if (!sec) { sec = document.createElement('section'); sec.id = secId; sec.className = 'card result'; $('results').prepend(sec); }
  sec.innerHTML = `<h2>${test.label.replace(/^\S+\s/, '')}</h2><div class="progress"><span class="spinner"></span> 正在分析并生成（约 1 分钟）…</div>`;
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const a = await post('/api/suggest', { image: state.image, type: key, gender: state.gender });
    sec.innerHTML = `<div class="lab-poster" id="lp-${key}">
      <div class="poster-head"><div class="poster-title">${a.title || test.label}</div>
        <div class="poster-sub">${a.intro || ''}</div></div>
      <div class="prow"><div class="strip-box"><div class="strip-loading"><span class="spinner"></span> 生成中…</div></div>
        <div class="strip-labels">${(a.options || []).map((c) => `<span>${c.hex ? `<i style="background:${c.hex}"></i>` : ''}${c.name}</span>`).join('')}</div></div>
      <div class="opt-notes">${(a.options || []).map((c) => `<div class="opt-note"><b>${c.name}</b>${c.desc || ''}</div>`).join('')}</div>
      <div class="poster-mark">AI 形象测试 · sg.yaoyuheng2001.me</div>
    </div>
    <div style="text-align:center;margin-top:14px"><button class="primary dl" data-key="${key}">⬇ 保存为图片</button></div>`;
    sec.querySelector('.dl').onclick = () => downloadCard(key);
    const box = sec.querySelector('.strip-box');
    try {
      const d = await post('/api/varystrip', { image: state.editImage, type: key, gender: state.gender, options: a.options });
      const img = new Image(); img.src = d.url; img.crossOrigin = 'anonymous';
      await new Promise((r) => { img.onload = r; img.onerror = r; });
      box.innerHTML = ''; box.appendChild(img);
      window.CSDAuth?.saveHistory({ type: key, title: a.title || test.label, thumb: state.image,
        payload: { options: a.options }, images: [d.url] });
    } catch (e) { box.innerHTML = `<div class="err">图片生成失败，可重试</div>`; }
  } catch (e) {
    sec.innerHTML = `<h2>${test.label.replace(/^\S+\s/, '')}</h2><div class="err">出错了：${e.message}</div>`;
  }
}

async function downloadCard(key) {
  const el = $('lp-' + key); if (!el) return;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#fbf7f1' });
    const a = document.createElement('a'); a.download = `我的${key}测试.png`; a.href = canvas.toDataURL('image/png'); a.click();
  } catch (e) { alert('保存失败：' + e.message); }
}
