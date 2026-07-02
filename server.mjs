// AI 个人色彩 × 风格穿搭 × 试穿预览 — 轻量级 demo 后端
// 全部走一个 OpenAI 兼容反代：GPT-5（多模态，看图+推理）+ gpt-image（生图）。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { seasonsRef, catalogRef, outfitRef } from './presets.mjs';
import { MAKEUP_VIBES, vibesFor, IMAGE_TEMPLATE } from './presets-makeup.mjs';
import { vibeLine } from './presets-vibe.mjs';

const __dir = fileURLToPath(new URL('.', import.meta.url));

// ── 临时本地缓存（生成的图片存盘，按请求哈希命中，重复请求秒回；24h 过期清理）──
const CACHE_DIR = join(__dir, 'cache');
mkdirSync(CACHE_DIR, { recursive: true });
const CACHE_TTL = 24 * 3600 * 1000;
function cleanupCache() {
  const now = Date.now();
  for (const f of readdirSync(CACHE_DIR)) {
    try { if (now - statSync(join(CACHE_DIR, f)).mtimeMs > CACHE_TTL) unlinkSync(join(CACHE_DIR, f)); } catch {}
  }
}
cleanupCache();
setInterval(cleanupCache, 3600 * 1000).unref();
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);
// 命中返回相对 url（兼容子路径部署），未命中返回 null
function cacheGet(key) { return existsSync(join(CACHE_DIR, key + '.png')) ? `cache/${key}.png` : null; }
function cachePut(key, buf) { writeFileSync(join(CACHE_DIR, key + '.png'), buf); return `cache/${key}.png`; }

// ── 用户管理 + 历史记录（无依赖：JSON 存盘 + node:crypto）──────────────
const DATA_DIR = join(__dir, 'data');
const MEDIA_DIR = join(DATA_DIR, 'media');   // 历史图片长期存放（无 TTL）
const HIST_DIR = join(DATA_DIR, 'hist');     // 每用户一个 <id>.json
mkdirSync(MEDIA_DIR, { recursive: true }); mkdirSync(HIST_DIR, { recursive: true });
const USERS_F = join(DATA_DIR, 'users.json');
const SESS_F = join(DATA_DIR, 'sessions.json');
const loadJSON = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const saveJSON = (f, o) => writeFileSync(f, JSON.stringify(o));
let users = loadJSON(USERS_F, {});      // key: username(lower) → {id,username,salt,hash,created}
let sessions = loadJSON(SESS_F, {});    // token → {userId, exp}
const SESS_TTL = 30 * 24 * 3600 * 1000;
function hashPw(pw, salt) { return scryptSync(pw, salt, 64).toString('hex'); }
function newToken() { return randomBytes(24).toString('hex'); }
function userByToken(req) {
  const t = req.headers['x-token']; if (!t) return null;
  const s = sessions[t]; if (!s || s.exp < Date.now()) { if (s) { delete sessions[t]; saveJSON(SESS_F, sessions); } return null; }
  return Object.values(users).find((u) => u.id === s.userId) || null;
}
const histFile = (id) => join(HIST_DIR, id + '.json');
function loadHist(id) { return loadJSON(histFile(id), []); }
// 把历史条目里引用的 cache 图复制进 media（长期保存），改写为 umedia/ 相对 url
function persistMedia(urls) {
  const out = [];
  for (const u of urls || []) {
    const m = String(u).match(/^cache\/([\w.-]+\.png)$/);
    if (!m) { out.push(u); continue; }
    const src = join(CACHE_DIR, m[1]); const dst = join(MEDIA_DIR, m[1]);
    try { if (existsSync(src) && !existsSync(dst)) writeFileSync(dst, readFileSync(src)); out.push('umedia/' + m[1]); }
    catch { out.push(u); }
  }
  return out;
}

// ── 极简 .env 加载（无依赖）─────────────────────────────────────────────
if (existsSync(join(__dir, '.env'))) {
  for (const line of readFileSync(join(__dir, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const PORT = process.env.PORT || 5178;
const API_KEY  = process.env.API_KEY || '';
const BASE_URL = (process.env.API_BASE || 'https://sub2api.yaoyuheng2001.me').replace(/\/$/, '');
const CHAT_MODEL  = process.env.CHAT_MODEL  || 'gpt-5.4-mini';   // 看图 + 推理（多模态）
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';  // 文生图（无照片时兜底）
const EDIT_MODEL  = process.env.EDIT_MODEL  || 'gpt-image-2';    // 真人换装（在用户照片上改穿搭）

// ── 对话调用（OpenAI 兼容，可带图，强制 JSON）──────────────────────────
async function chatJSON(system, user, images = []) {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : user;
  const body = {
    model: CHAT_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: { type: 'json_object' },
  };
  const r = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('模型输出被截断，请重试');
  return parseLoose(data.choices?.[0]?.message?.content || '{}');
}

// 宽松 JSON 解析：去掉 ```fence```、行内注释、尾逗号
function parseLoose(text) {
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  s = s.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(s);
}

// ── 真人换装（OpenAI 兼容 /images/edits，multipart，在用户照片上改穿搭）──
// 把用户档案(性别/体型/肤色等)拼成"画面人物"约束串，注入每次生图，锁定性别与身份
function subjectLine(s) {
  if (!s) return '';
  const g = s.gender === '男' ? '男性' : s.gender === '女' ? '女性' : '';
  const parts = [g && `性别为${g}（务必生成${g}，不得改变性别）`, s.build && `${s.build}体型`, s.skin_tone && `${s.skin_tone}肤色`, s.hair && s.hair, s.age && s.age].filter(Boolean);
  return parts.length ? `【画面人物固定特征，必须严格保持】${parts.join('、')}。\n` : '';
}
async function editImage(dataUrl, prompt, size = '1024x1024', subject = '') {
  const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) throw new Error('换装需要有效的用户照片');
  prompt = subject + prompt;
  const buf = Buffer.from(m[2], 'base64');
  const key = 'edit-' + hash(EDIT_MODEL + '|' + size + '|' + prompt + '|' + hash(m[2]));
  const hit = cacheGet(key);
  if (hit) return { url: hit, mode: 'edit', cached: true };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) { // 上游 edits 偶发 5xx，退避重试
    if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt));
    try {
      const fd = new FormData();
      fd.append('model', EDIT_MODEL);
      fd.append('image', new Blob([buf], { type: m[1] }), 'user.png');
      fd.append('prompt', prompt);
      fd.append('size', size);
      const r = await fetch(`${BASE_URL}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}` }, // 不要手设 Content-Type，FormData 自带 boundary
        body: fd,
        signal: AbortSignal.timeout(200_000),
      });
      if (!r.ok) throw new Error(`edit ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const data = await r.json();
      const d = data.data?.[0] || {};
      if (d.b64_json) return { url: cachePut(key, Buffer.from(d.b64_json, 'base64')), mode: 'edit' };
      if (d.url) { const b = Buffer.from(await (await fetch(d.url)).arrayBuffer()); return { url: cachePut(key, b), mode: 'edit' }; }
      throw new Error('换装返回无 url/b64');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── 生图调用（OpenAI 兼容 /images/generations）────────────────────────
async function genImage(prompt) {
  const key = 'gen-' + hash(IMAGE_MODEL + '|' + prompt);
  const hit = cacheGet(key);
  if (hit) return { url: hit, mode: 'gen', cached: true };
  const body = { model: IMAGE_MODEL, prompt, size: '1024x1024', n: 1 };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${BASE_URL}/v1/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error(`image ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const data = await r.json();
      const d = data.data?.[0] || {};
      if (d.b64_json) return { url: cachePut(key, Buffer.from(d.b64_json, 'base64')), mode: 'gen' };
      if (d.url) { const b = Buffer.from(await (await fetch(d.url)).arrayBuffer()); return { url: cachePut(key, b), mode: 'gen' }; }
      throw new Error('生图返回无 url/b64');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── Prompt 模板 ────────────────────────────────────────────────────────
const DIAGNOSE_SYS = `你是专业的个人色彩顾问（四季12型体系）。用户会给你一张自拍 + 浏览器 CV 抠出的主色测量值。
请：①先客观观察照片（看肤/发/瞳的颜色、冷暖、对比、光照），②再据此做季型诊断。
reasoning 用**通俗、亲和**的中文向用户解释为什么是这个季型，像专业顾问当面讲解一样；**不要出现 Lab、L=、a=、b=、ΔE、十六进制色号(#xxxxxx)、或裸露的数字测量值**——用"偏暖的米杏色""深棕近黑的发色""明暗对比适中"这种自然说法代替。
诚实边界：单张非受控自拍受光照影响，定位娱乐/探索；人脸不清或光照差时给低 confidence。
只输出 JSON（中文）：
{
  "observed": {
    "skin_hex": "#xxxxxx", "skin_desc": "如：白皙带粉",
    "hair_hex": "#xxxxxx", "hair_desc": "如：自然黑",
    "eye_hex":  "#xxxxxx", "eye_desc":  "如：深棕",
    "undertone_hint": "cool|warm|neutral + 简短依据",
    "contrast_hint": "高/中/低", "lighting": "如：自然光/偏黄室内光"
  },
  "profile": {
    "gender": "女|男|不确定", "age_range": "如：20-30",
    "build": "如：偏瘦/匀称/丰满（看得出才填，否则 不确定）",
    "hair_style": "如：黑长直/短发/卷发",
    "shot": "face|upper|full（这张照片是脸部特写/半身/全身，决定能否换装试穿）"
  },
  "season": "冷夏 (Cool Summer)", "season_4": "夏", "undertone": "cool|warm|neutral",
  "confidence": 0.0-1.0,
  "metrics": { "value": "高/中/低", "chroma": "鲜艳/柔和", "contrast": "高/中/低" },
  "palette": ["#xxxxxx", 6-8个适合的代表色],
  "avoid": ["#xxxxxx", 2-4个不建议的颜色],
  "reasoning": "一段通俗亲和的中文解释，结合你看到的肤发瞳与冷暖对比说明为何是此季型（不带任何技术代码/色号/数字）",
  "tips": ["2-3条可执行建议：发色/腮红/口红色调方向"]
}`;

const OUTFIT_SYS = `你是资深穿搭造型师。给定用户季型 + 个人色板 + 性别/身形，直接给 2-3 套**成套穿搭造型**——不分场合、不谈价格。
每套：①定 2-3 个主色（都必须落在个人色板内，给中文名 + 准确 hex）；②一句成套单品描述 garments（用于生成预览图，如"灰咖色大衣 + 白色打底 + 深蓝直筒牛仔裤 + 乐福鞋"），款式贴合性别与身形；③一段有质感的中文点评 analysis（像小红书博主，讲同色系/层次/深浅过渡/为何配 ta 的季型与身形，60-90 字）。
只输出 JSON：
{ "looks": [ {
  "title": "雾感大地色系",
  "colors": [{"name":"灰咖色","hex":"#8B8178"},{"name":"驼色","hex":"#B08654"}],
  "garments": "灰咖色大衣 + 白色打底 + 深蓝直筒牛仔裤 + 乐福鞋",
  "analysis": "以灰咖色大衣作为基础底色，低调优雅又自带柔和暖意，内搭叠加驼色提升层次感，运用同色系渐变，深浅过渡自然……"
} ] }`;

const COLOR_SYS = `你是专业的个人色彩与妆容顾问（四季十二型体系）。请**先分三轴独立判断，再合成季型**，不得有默认倾向。
1) 冷暖 undertone：看肤色/唇色/血管——泛粉、泛蓝紫、气色偏冷=cool；泛黄、金橄榄、桃暖=warm；都不明显=neutral。⚠️**务必排除室内暖光/滤镜把整张脸染黄的影响**，别因环境光就判暖；**深肤色同样可能是 cool（→深冬/冷冬），绝不能一律判暖**。
2) 明度 value：浅 / 中 / 深。
3) 纯度 chroma：清透鲜艳 / 柔和浊。
三轴定完再落到 12 季型：**春夏秋冬四族都要在候选内认真权衡，避免无差别地判"秋 / 偏暖"**（这是常见错误倾向，请刻意纠偏）。
【12 季型标准参考】season 必须从下列之一中选（用「中文名 (English)」格式），推荐色优先采用该季型的标准代表色并可据本人微调：
${seasonsRef()}
颜色名称用中文常见叫法（如：奶茶杏、雾霾蓝、橄榄绿、燕麦白），并给准确 hex。避免色应与该季型冲突（过冷/过暖/过艳/过浊）。
诚实边界：单张照片受光照影响，给合理结论即可。
只输出 JSON（中文）：
{
  "gender": "女|男（据照片判断）",
  "undertone": "cool|warm|neutral",
  "value": "浅|中|深",
  "chroma": "清透|柔和",
  "skin_tone": "综合一句（如：中性偏暖、浅而柔）",
  "season": "如：柔秋 (Soft Autumn)",
  "recommend": [{ "name": "奶茶杏", "hex": "#C8A98A" }, ...正好 6 个最显气色的颜色],
  "neutral":   [{ "name": "牛仔蓝", "hex": "#5B7A99" }, ...正好 6 个中性可穿的颜色],
  "avoid":     [{ "name": "荧光黄绿", "hex": "#C8D400" }, ...正好 6 个显疲惫/突兀要避开的颜色],
  "makeup": {
    "eye":   { "hex": "#9B7B5E", "desc": "大地色打底，自然深邃" },
    "blush": { "hex": "#E0A0A0", "desc": "蜜桃粉色调，提升气色" },
    "lip":   { "hex": "#B5625C", "desc": "干燥玫瑰色，自然显白" },
    "brow":  { "hex": "#8B6F52", "desc": "自然平眉，柔和修饰" }
  },
  "summary": "一句话总结你的色彩气质"
}`;

// ── 形象测试类型（花纹/发色/发型/妆容/首饰）——统一 suggest + 变体色带 ──
const TYPES = {
  pattern:   { label: '花纹', female: false, count: 6,
    suggest: '推荐适合 TA 的服装花纹/图案（如 纯色、细条纹、千鸟格、小碎花、波点、格纹、菱格 等），选最适合的 6 个；每个给中文名 + 一句为什么适合。',
    vary: '所穿上衣的花纹图案（统一中性米色调，只花纹不同）', keep: '脸型、五官、表情、发型、发色、背景' },
  haircolor: { label: '发色', female: false, count: 6,
    suggest: '推荐适合 TA 肤色的发色（如 自然黑、深棕、巧克力棕、亚麻棕、焦糖棕、闷青灰、酒红棕、奶茶灰 等），选最适合的 6 个；每个给中文名 + hex + 一句为什么。',
    vary: '头发颜色', keep: '脸型、五官、表情、发型长度与造型、衣服、背景' },
  hairstyle: { label: '发型', female: false, count: 6,
    suggest: '推荐适合 TA 脸型的发型（如 黑长直、齐肩发、法式波波、羊毛卷、内扣中长发、高马尾、空气刘海、八字刘海 等），选最适合的 6 个；每个给中文名 + 一句为什么。',
    vary: '发型', keep: '脸型、五官、表情、发色、衣服、背景' },
  makeup:    { label: '妆容', count: 5,
    suggest: '推荐适合 TA 的妆容/妆感方向，务必贴合性别：'
      + '若为男性，给自然得体的男士修饰（如 清爽素颜感、控油雾面、遮瑕提亮气色、自然眉形修饰、淡色润唇、轮廓修容），不要浓妆；'
      + '若为女性，给（裸妆、日常气色妆、通勤淡妆、约会精致妆、韩系水光、欧美深邃 等）。'
      + '选最适合的 5 个；每个给中文名 + 一句重点。',
    vary: '脸上的妆感/妆容风格（按性别自然得体）', keep: '脸型、五官轮廓、发型、发色、衣服、背景' },
  jewelry:   { label: '首饰', count: 5,
    suggest: '推荐适合 TA 的首饰/配饰风格，务必贴合性别：'
      + '若为男性，给男士向（简约手表、素圈戒指、细项链/吊坠、皮质或金属手链、极简耳钉、领针）；'
      + '若为女性，给（金色圆环、银色几何、珍珠、复古金流苏、极简细线条、大颗宝石 等）。'
      + '选最适合的 5 个；每个给中文名 + 一句为什么。',
    vary: '佩戴的首饰/配饰（按性别合适：男士手表/戒指/项链，女士耳饰/项链等）', keep: '脸型、五官、表情、发型、发色、衣服、背景' },
};

// ── HTTP ───────────────────────────────────────────────────────────────
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // 1) 测色：GPT-5 看图 + 推理一次完成
    if (req.method === 'POST' && url.pathname === '/api/diagnose') {
      const b = await readBody(req);
      const f = b.features || {};
      const user = `【浏览器 CV 抠出的主色测量】
- 肤色：${f.skinHex || '?'}（CIELAB L=${f.skinL ?? '?'}，a=${f.skinA ?? '?'}，b=${f.skinB ?? '?'}）
- 发色：${f.hairHex || '?'}（L=${f.hairL ?? '?'}）
- 发肤明度对比：ΔL=${f.contrast ?? '?'}
- 检出整体色彩：${(f.palette || []).join(', ') || '无'}
【用户补充】${b.note || '无'}
${b.image ? '请先看这张自拍，再综合 CV 测量诊断季型并给报告。' : '（本次无图，仅按 CV 测量诊断。）'}`;
      const out = await chatJSON(DIAGNOSE_SYS, user, b.image ? [b.image] : []);
      return sendJSON(res, 200, out);
    }

    // 2) 穿搭造型（成套 look + 配色 + 点评，不分场合/价格）
    if (req.method === 'POST' && url.pathname === '/api/outfit') {
      const b = await readBody(req);
      const p = b.profile || {};
      const user = `季型：${b.season}；个人色板：${(b.palette || []).join(', ')}；`
        + `性别：${p.gender || '不确定'}；身高 ${p.height || '?'}cm，体重 ${p.weight || '?'}kg，体型 ${p.build || '匀称'}。请给 2-3 套成套造型。`;
      const out = await chatJSON(OUTFIT_SYS, user);
      // 兼容旧页面（index one-click 读 outfits）
      out.outfits = (out.looks || []).map((lk) => ({ title: lk.title, occasion: '', items: [{ category: '造型', desc: lk.garments || '', hex: lk.colors?.[0]?.hex || '#ccc' }], why: lk.analysis || '', total_price: '' }));
      return sendJSON(res, 200, out);
    }

    // 3) 试穿预览：有照片→在真人照片上换装；无照片→文生图兜底
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const b = await readBody(req);
      const colors = (b.palette || []).join(', ');
      const subj = subjectLine(b.subject);
      if (b.image && b.atmos && b.season) {
        // 氛围感模式：把本人放进贴合季型的氛围大片（可改背景/光线/表情/发型），保脸保性别
        const prompt = `把画面中的这个人放进一张有氛围感的时尚人像大片，保持是本人：\n`
          + `穿搭换成【${b.outfit || '一套协调的当季造型'}】，服装配色限定【${colors}】。\n`
          + `氛围要求 → ${vibeLine(b.season)}。\n`
          + `【严格保持】本人的脸型、五官比例、肤色与**性别**不变；不要换脸、不要美颜到失真、不要改变身份与性别。\n`
          + `可以调整背景、光线、姿态与表情来贴合上述氛围。写实氛围人像摄影、浅景深虚化背景、自然布料与皮肤质感，无文字、无水印。`;
        return sendJSON(res, 200, await editImage(b.image, prompt, '1024x1024', subj));
      }
      if (b.image) {
        // 保脸配方（借鉴 YanAI）：硬性列举「不要改」+ 关键约束重复 + 保留皮肤纹理防身份漂移
        const prompt = `这是同一个真人，请只更换 ta 身上的服装，严格保留本人身份。\n`
          + `要替换成的穿搭：${b.outfit || '一套协调的当季搭配'}；服装配色限定在：${colors}。\n`
          + `【严格保留】人物的脸型、五官比例、表情、发型、发色、肤色、体型体态、姿势与背景、以及**性别**；保留真实皮肤纹理、毛孔与细纹，不要磨皮、不要瘦脸、不要换脸、不要改变人脸/身材/性别。\n`
          + `就是这个人本人！就是这个人本人！只换衣服，其它一切不变。\n`
          + `写实质感、自然布料光影，无文字、无水印。`;
        return sendJSON(res, 200, await editImage(b.image, prompt, '1024x1024', subj));
      }
      const prompt = `Fashion lookbook photo, full-body, clean studio background. `
        + `Outfit: ${b.outfit || 'a coordinated seasonal outfit'}. Strictly use this color palette: ${colors}. `
        + `Soft natural lighting, realistic fabric texture, editorial style, no text, no watermark.`;
      return sendJSON(res, 200, await genImage(prompt));
    }

    // 4) 色彩测试海报 — 分析（GPT-5 看证件照出完整色彩 + 妆容方案）
    if (req.method === 'POST' && url.pathname === '/api/coloranalysis') {
      const b = await readBody(req);
      const conf = b.qc?.wb_conf;
      // 低置信（拍摄质量差/无白纸参照）→ 让模型把冷暖输出成区间、降 confidence、给重拍提示
      const qcHint = (conf != null && conf < 0.6)
        ? `\n【拍摄质量提示】本图白平衡置信度较低(${conf})：冷暖判断可能受光照影响。请把 undertone/skin_tone 给成**区间/保守**表述（如"中性、偏暖但不确定"），confidence 不超过 0.6，并在 reshoot 里给一句"建议自然光下重拍、或用A4白纸参照"。额外输出字段 "reshoot"（一句话）与 "wb_conf":${conf}。`
        : '';
      const out = await chatJSON(COLOR_SYS + qcHint, '请分析这张证件照。', b.image ? [b.image] : []);
      if (conf != null) out.wb_conf = conf;
      return sendJSON(res, 200, out);
    }

    // 5) 色彩测试海报 — 一条色带（同一人并排穿多种颜色，证件照风格）
    if (req.method === 'POST' && url.pathname === '/api/strip') {
      const b = await readBody(req);
      const names = (b.colors || []).map((c) => c.name).filter(Boolean);
      if (!b.image || !names.length) return sendJSON(res, 400, { error: '缺少照片或颜色' });
      const g = b.gender === '男' ? '男性' : '女性';
      const prompt = `证件照风格人像拼图，纯净浅灰背景，头肩特写。`
        + `画面里是同一位${g}（务必是${g}，保持性别不变），脸型、五官、发型、表情保持完全一致，从左到右并排出现 ${names.length} 次，`
        + `依次穿着这些颜色的圆领针织衫：${names.join('、')}。`
        + `每个人物等宽、间距均匀、垂直居中对齐；写实摄影质感，柔和打光；严格不要任何文字、字母、数字或水印。`;
      return sendJSON(res, 200, await editImage(b.image, prompt, '1536x1024', subjectLine(b.subject)));
    }

    // 6) 通用形象测试 — 建议（GPT-5 出适合的选项）
    if (req.method === 'POST' && url.pathname === '/api/suggest') {
      const b = await readBody(req);
      const t = TYPES[b.type];
      if (!t) return sendJSON(res, 400, { error: '未知测试类型' });
      const who = b.gender ? `照片中的人是${b.gender}性，请给出符合该性别的建议。` : '请先判断性别，再给出符合该性别的建议。';
      const cat = catalogRef(b.type, b.gender);
      const sys = `你是专业形象顾问。看这张正面照，${t.suggest}
${cat ? `常见可选（优先从中挑选贴合本人的，也可补充更合适的）：${cat}` : ''}
${who}
诚实边界：单张照片受光照影响，给合理结论即可。
只输出 JSON（中文）：{ "title": "如：适合你的发型", "intro": "一句总述你适合的方向", "options": [{ "name": "中文名", "hex": "#可选(发色/颜色相关才给)", "desc": "为什么适合你" }, ...正好 ${t.count} 个] }`;
      return sendJSON(res, 200, await chatJSON(sys, who + '请分析这张照片。', b.image ? [b.image] : []));
    }

    // 7) 通用形象测试 — 变体色带（同一人并排展示每个选项）
    if (req.method === 'POST' && url.pathname === '/api/varystrip') {
      const b = await readBody(req);
      const t = TYPES[b.type];
      const names = (b.options || []).map((c) => c.name).filter(Boolean);
      if (!t || !b.image || !names.length) return sendJSON(res, 400, { error: '缺少参数' });
      const g = b.gender === '男' ? '男性' : '女性';
      const prompt = `证件照风格人像拼图，纯净浅灰背景，头肩特写。`
        + `画面里是同一位${g}（务必是${g}，保持性别不变），${t.keep}保持完全一致，从左到右并排出现 ${names.length} 次，`
        + `${t.vary}依次为：${names.join('、')}。`
        + `每个人物等宽、间距均匀、垂直居中对齐；写实摄影质感，柔和打光；严格不要任何文字、字母、数字或水印。`;
      return sendJSON(res, 200, await editImage(b.image, prompt, '1536x1024', subjectLine(b.subject)));
    }

    // 8) 妆容氛围感 — 选风格（GPT 从氛围妆库里挑最合适的 3 种）
    if (req.method === 'POST' && url.pathname === '/api/makeup') {
      const b = await readBody(req);
      const vibes = vibesFor(b.gender === '男' ? '男' : '女');
      const list = vibes.map((v, i) => `${i + 1}. ${v.name}——${v.vibe}`).join('\n');
      const sys = `你是妆容顾问。看这张脸，从下列氛围妆风格中挑出**最适合 ta 的 3 种**（贴合五官/气质/肤色），并给一句为什么。\n${list}\n`
        + `只输出 JSON：{ "picks": [{ "name": "必须与上面列表中的名称完全一致", "why": "为什么适合" }, ...正好 3 个] }`;
      const out = await chatJSON(sys, '请分析这张照片并挑 3 种氛围妆。', b.image ? [b.image] : []);
      const picks = (out.picks || []).map((p) => {
        const v = vibes.find((x) => x.name === p.name) || vibes[0];
        return { key: v.key, name: v.name, vibe: v.vibe, desc: v.desc_for_image, why: p.why || '' };
      }).slice(0, 3);
      return sendJSON(res, 200, { picks: picks.length ? picks : vibes.slice(0, 3).map((v) => ({ key: v.key, name: v.name, vibe: v.vibe, desc: v.desc_for_image, why: '' })) });
    }

    // 9) 妆容氛围感 — 在本人照片上生成一张氛围人像
    if (req.method === 'POST' && url.pathname === '/api/portrait') {
      const b = await readBody(req);
      if (!b.image || !b.desc) return sendJSON(res, 400, { error: '缺少照片或风格' });
      let prompt = IMAGE_TEMPLATE.replace('{desc}', b.desc);
      if (b.atmos && b.season) prompt += `\n【氛围】把成片处理成贴合季型的氛围人像 → ${vibeLine(b.season)}。可微调背景/光线/发丝以增强氛围，但脸与性别保持是本人。`;
      return sendJSON(res, 200, await editImage(b.image, prompt, '1024x1024', subjectLine(b.subject)));
    }

    // ── 用户管理 ──────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const b = await readBody(req);
      const uname = String(b.username || '').trim(); const pw = String(b.password || '');
      if (uname.length < 2 || uname.length > 20) return sendJSON(res, 400, { error: '用户名需 2-20 个字符' });
      if (pw.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
      if (users[uname.toLowerCase()]) return sendJSON(res, 409, { error: '用户名已被占用' });
      const salt = randomBytes(16).toString('hex');
      const u = { id: randomBytes(8).toString('hex'), username: uname, salt, hash: hashPw(pw, salt), created: Date.now() };
      users[uname.toLowerCase()] = u; saveJSON(USERS_F, users);
      const token = newToken(); sessions[token] = { userId: u.id, exp: Date.now() + SESS_TTL }; saveJSON(SESS_F, sessions);
      return sendJSON(res, 200, { token, username: u.username });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const b = await readBody(req);
      const u = users[String(b.username || '').trim().toLowerCase()];
      const ok = u && (() => { const h = Buffer.from(hashPw(String(b.password || ''), u.salt), 'hex'); const s = Buffer.from(u.hash, 'hex'); return h.length === s.length && timingSafeEqual(h, s); })();
      if (!ok) return sendJSON(res, 401, { error: '用户名或密码错误' });
      const token = newToken(); sessions[token] = { userId: u.id, exp: Date.now() + SESS_TTL }; saveJSON(SESS_F, sessions);
      return sendJSON(res, 200, { token, username: u.username });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const t = req.headers['x-token']; if (t && sessions[t]) { delete sessions[t]; saveJSON(SESS_F, sessions); }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const u = userByToken(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
      return sendJSON(res, 200, { username: u.username });
    }

    // ── 历史记录 ──────────────────────────────────────
    if (url.pathname === '/api/history') {
      const u = userByToken(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
      if (req.method === 'GET') return sendJSON(res, 200, { items: loadHist(u.id) });
      if (req.method === 'POST') {
        const b = await readBody(req);
        const list = loadHist(u.id);
        const entry = { id: randomBytes(8).toString('hex'), type: b.type || 'result', title: (b.title || '').slice(0, 60),
          ts: Date.now(), thumb: (b.thumb || '').slice(0, 400000), payload: b.payload || null, images: persistMedia(b.images) };
        list.unshift(entry); if (list.length > 100) list.length = 100;
        saveJSON(histFile(u.id), list);
        return sendJSON(res, 200, entry);
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const list = loadHist(u.id).filter((e) => e.id !== id);
        saveJSON(histFile(u.id), list); return sendJSON(res, 200, { ok: true });
      }
    }

    // 历史图片（长期，随机文件名）
    if (url.pathname.startsWith('/umedia/')) {
      const mf = join(MEDIA_DIR, url.pathname.slice(8).replace(/[^a-zA-Z0-9._-]/g, ''));
      const data = await readFile(mf);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
      return res.end(data);
    }

    if (url.pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true, key: !!API_KEY, base: BASE_URL, chat: CHAT_MODEL, image: IMAGE_MODEL, types: Object.keys(TYPES), users: Object.keys(users).length });
    }

    // 缓存图片
    if (url.pathname.startsWith('/cache/')) {
      const cf = join(CACHE_DIR, url.pathname.slice(7).replace(/[^a-zA-Z0-9._-]/g, ''));
      const data = await readFile(cf);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(data);
    }

    // 静态文件
    let p = url.pathname === '/' ? '/index.html' : url.pathname.replace(/\.\./g, '');
    const file = join(__dir, 'public', p);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    return res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(e.message);
    return sendJSON(res, 500, { error: String(e.message || e) });
  }
});

const HOST = process.env.HOST || '127.0.0.1'; // 默认只听本机，由 nginx 反代对外
server.listen(PORT, HOST, () => {
  console.log(`\n  AI 个人色彩 demo → http://${HOST}:${PORT}`);
  console.log(`  反代: ${BASE_URL} key=${API_KEY ? '✓' : '✗'}`);
  console.log(`  看图+推理: ${CHAT_MODEL}   真人换装: ${EDIT_MODEL}   文生图兜底: ${IMAGE_MODEL}\n`);
});
