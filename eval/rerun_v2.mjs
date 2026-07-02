import { readFile, writeFile } from 'node:fs/promises';
const DIR = '/home/yyh/color-style-demo/eval/';
const B = 'https://sg.yaoyuheng2001.me/colorstyle';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const man = JSON.parse(await readFile(DIR + 'manifest.json', 'utf8'));
const four = (s) => { s = s || ''; return /春|Spring/i.test(s) ? '春' : /夏|Summer/i.test(s) ? '夏' : /秋|Autumn/i.test(s) ? '秋' : /冬|Winter/i.test(s) ? '冬' : '?'; };
const out = [];
for (const f of man) {
  const img = 'data:image/jpeg;base64,' + (await readFile(DIR + f.path)).toString('base64');
  let d = null;
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(B + '/api/coloranalysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: img }) });
      if (r.status === 429) { await sleep(12000); continue; } d = await r.json(); break;
    } catch (e) { await sleep(4000); }
  }
  const rec = { id: f.id, race: f.race, gender: f.gender, season: d?.season, four: four(d?.season), undertone: d?.undertone, value: d?.value, chroma: d?.chroma, gender_det: d?.gender };
  out.push(rec);
  console.log(String(f.race).padEnd(15), String(f.gender).padEnd(7), '→', rec.four, String(d?.season || 'ERR').slice(0, 20), '| ut=' + rec.undertone, '| g=' + rec.gender_det);
  await sleep(3500);
}
await writeFile(DIR + 'results_v2.jsonl', out.map((r) => JSON.stringify(r)).join('\n'));
const tally = { 春: 0, 夏: 0, 秋: 0, 冬: 0, '?': 0 }, ut = {}, seasons = {};
out.forEach((r) => { tally[r.four]++; ut[r.undertone] = (ut[r.undertone] || 0) + 1; if (r.season) seasons[r.season] = (seasons[r.season] || 0) + 1; });
const n = out.length;
console.log('\n===== 新算法结果 (n=' + n + ') =====');
console.log('四季:', JSON.stringify(tally), ` 秋占比=${(tally['秋'] / n * 100).toFixed(0)}%`);
console.log('undertone:', JSON.stringify(ut));
console.log('12型用到的类数:', Object.keys(seasons).length, Object.keys(seasons).join('/'));
const byRace = {}; out.forEach((r) => (byRace[r.race] = byRace[r.race] || []).push(r.four + (r.undertone === 'cool' ? '(cool)' : '')));
console.log('\n分族裔四季:'); for (const [race, arr] of Object.entries(byRace)) console.log('  ' + race.padEnd(15), arr.join(', '));
const gok = out.filter((r) => (r.gender_det === '男') === (r.gender === 'Male')).length;
console.log('\n性别检测正确:', gok + '/' + n);
const cool = out.filter((r) => r.undertone === 'cool').length;
console.log('冷调总数:', cool + '/' + n, '(旧算法 4/34)');
const blackCool = out.filter((r) => r.race === 'Black' && r.undertone === 'cool').length;
const blackN = out.filter((r) => r.race === 'Black').length;
console.log('Black 冷调:', blackCool + '/' + blackN, '(旧算法 0)');
console.log('\nDONE');
