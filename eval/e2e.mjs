// 端到端用户链路模拟：注册→上传→测色→建档→历史→测色海报→穿搭试穿→形象测试→妆容→重登恢复
import fs from 'node:fs';
const BASE = 'https://sg.yaoyuheng2001.me/colorstyle/';
const U = 'e2e_' + Date.now().toString(36);
const P = 'test123456';
let token = '';
const img = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('../public/capture-example.jpg', import.meta.url)).toString('base64');

const results = [];
function ok(step, cond, detail) { results.push({ step, ok: !!cond, detail }); console.log(`${cond ? '✅' : '❌'} ${step}${detail ? '  — ' + detail : ''}`); }
async function api(path, method = 'GET', body, ms = 180000) {
  const h = { 'Content-Type': 'application/json' }; if (token) h['x-token'] = token;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path.replace(/^\//, ''), { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const d = await r.json().catch(() => ({}));
    const dt = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    if (!r.ok) throw new Error((d.error || ('HTTP ' + r.status)) + ' (' + dt + ')');
    d.__dt = dt; return d;
  } finally { clearTimeout(t); }
}
const isImg = (u) => typeof u === 'string' && (u.startsWith('data:image') || u.startsWith('http') || u.startsWith('/'));

(async () => {
  console.log('== 模拟用户:', U, '==\n');

  // 1) 注册
  try { const d = await api('/api/auth/register', 'POST', { username: U, password: P }); token = d.token; ok('注册 + 拿 token', d.token && d.username === U); }
  catch (e) { return ok('注册', false, e.message); }

  // 2) 测色（上传照片后前端调 coloranalysis）
  let a;
  try {
    a = await api('/api/coloranalysis', 'POST', { image: img, qc: { wb_conf: 0.6, verdict: 'edge' } });
    const conf = a.confidence;
    ok('AI 测色', a.season && Array.isArray(a.recommend) && a.recommend.length > 0,
       `季型=${a.season} 冷暖=${a.undertone} 性别=${a.gender} 置信度=${conf != null ? Math.round(conf * 100) + '%' : '缺失'} 推荐色=${(a.recommend || []).length} 避免色=${(a.avoid || []).length} ${a.__dt}`);
    ok('置信度是真实数值(非硬编码80%)', typeof conf === 'number' && conf > 0 && conf < 1 && Math.round(conf * 100) !== 80, `${Math.round((conf || 0) * 100)}%`);
    ok('返回性别字段(修复男→女bug的依据)', a.gender === '男' || a.gender === '女', a.gender);
  } catch (e) { return ok('AI 测色', false, e.message); }

  // 3) 存服务端档案（登录免重传的关键）
  try { const d = await api('/api/profile', 'POST', { analysis: a, profile: { gender: a.gender, build: '匀称', height: '165', weight: '52' }, thumb: img, editImage: img }); ok('保存服务端档案', d.ok !== false); }
  catch (e) { ok('保存服务端档案', false, e.message); }

  // 4) 写历史 + 读历史
  try { await api('/api/history', 'POST', { type: 'color', title: a.season || '测色档案', thumb: img, payload: a, images: [] }); const h = await api('/api/history'); ok('历史写入+读取', (h.items || []).some((e) => e.type === 'color'), `共 ${(h.items || []).length} 条`); }
  catch (e) { ok('历史', false, e.message); }

  const cols = (a.recommend || []).slice(0, 4).map((c) => c.hex).filter(Boolean);

  // 5) 色彩海报 strip（真人上身推荐色带）
  try { const d = await api('/api/strip', 'POST', { image: img, gender: a.gender, colors: cols, subject: { gender: a.gender, build: '匀称', skin_tone: a.skin_tone } }); ok('色彩测试海报(图)', isImg(d.url), d.__dt); }
  catch (e) { ok('色彩测试海报(图)', false, e.message); }

  // 6) 穿搭：outfit(文本方案) → preview(真人试穿图)
  let looks;
  try { const o = await api('/api/outfit', 'POST', { analysis: a, subject: { gender: a.gender } }); looks = o.looks || []; ok('穿搭方案(文本)', looks.length > 0, `${looks.length} 套 · ${(looks[0] && looks[0].title) || ''} ${o.__dt}`); }
  catch (e) { ok('穿搭方案(文本)', false, e.message); }
  if (looks && looks[0]) {
    try { const d = await api('/api/preview', 'POST', { image: img, outfit: looks[0].garments, palette: cols, subject: { gender: a.gender }, season: a.season, atmos: true }); ok('穿搭真人试穿(图·氛围感)', isImg(d.url), d.__dt); }
    catch (e) { ok('穿搭真人试穿(图)', false, e.message); }
  }

  // 7) 形象测试：suggest(选项) → varystrip(变体色带图)
  try {
    const s = await api('/api/suggest', 'POST', { image: img, type: 'haircolor', gender: a.gender });
    const opts = s.options || s.items || [];
    ok('形象测试·发色推荐(文本)', opts.length > 0, `${opts.length} 项 ${s.__dt}`);
    const d = await api('/api/varystrip', 'POST', { image: img, type: 'haircolor', gender: a.gender, options: opts, subject: { gender: a.gender } });
    ok('形象测试·发色变体(图)', isImg(d.url), d.__dt);
  } catch (e) { ok('形象测试·发色', false, e.message); }

  // 8) 妆容：makeup(方案) → portrait(氛围感妆容人像图)
  try {
    const m = await api('/api/makeup', 'POST', { image: img, gender: a.gender, season: a.season });
    const plans = m.plans || m.options || [];
    ok('妆容方案(文本)', plans.length > 0 || !!m.desc, `${plans.length} 套 ${m.__dt}`);
    const desc = (plans[0] && (plans[0].desc || plans[0].name)) || '当季氛围感妆容';
    const d = await api('/api/portrait', 'POST', { image: img, desc, subject: { gender: a.gender }, season: a.season, atmos: true });
    ok('妆容氛围感人像(图)', isImg(d.url), d.__dt);
  } catch (e) { ok('妆容', false, e.message); }

  // 9) 重新登录 → 恢复服务端档案（模拟"登录后免重传直接进首页"）
  try {
    token = '';
    const l = await api('/api/auth/login', 'POST', { username: U, password: P });
    token = l.token;
    const prof = await api('/api/profile');
    ok('重登恢复档案(登录跳转首页的依据)', prof && prof.analysis && prof.analysis.season === a.season, `恢复季型=${prof && prof.analysis && prof.analysis.season}`);
  } catch (e) { ok('重登恢复档案', false, e.message); }

  console.log('\n== 汇总 ==');
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} 通过`);
  const fail = results.filter((r) => !r.ok);
  if (fail.length) { console.log('失败项：'); fail.forEach((f) => console.log('  ✗', f.step, '—', f.detail)); process.exitCode = 1; }
  else console.log('🎉 全链路通过');
})();
