import { readFile, writeFile } from 'node:fs/promises';
const B = 'http://localhost:5178';
const post = async (p, body) => {
  const r = await fetch(B + p, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + (await r.text()).slice(0,200));
  return r.json();
};
const img = 'data:image/png;base64,' + (await readFile('/tmp/prev.png')).toString('base64');
const features = { skinHex:'#977c63', skinL:54, skinA:7, skinB:18, hairHex:'#3b2f28', hairL:22, contrast:32, palette:['#c2c0be','#cbc9c8','#9e9e9e','#2f363c'] };
const dir = '/home/yyh/color-style-demo/public/demo-assets/';

console.log('diagnose...');
const report = await post('/api/diagnose', { features, image: img, note: '无' });
await writeFile(dir+'report.json', JSON.stringify(report));
console.log('  season', report.season, report.profile);

console.log('outfit...');
const profile = { gender: report.profile?.gender || '女', height: 165, weight: 52, build: report.profile?.build || '匀称' };
const of = await post('/api/outfit', { season: report.season, palette: report.palette, profile, occasion:'通勤', budget: 500 });
const outfits = (of.outfits||[]).slice(0,3);
await writeFile(dir+'outfits.json', JSON.stringify({ outfits, profile }));
console.log('  outfits', outfits.length);

// copy selfie
await writeFile(dir+'selfie.jpg', (await readFile('/tmp/face.jpg')));

for (let i=0;i<outfits.length;i++){
  const desc = (outfits[i].items||[]).map(it=>it.desc).join('，');
  console.log('tryon', i+1, desc);
  try {
    const pv = await post('/api/preview', { outfit: desc, palette: report.palette, image: img });
    const b64 = pv.url.split(',',2)[1];
    await writeFile(dir+`tryon${i+1}.png`, Buffer.from(b64,'base64'));
    console.log('  saved tryon'+(i+1));
  } catch(e){ console.log('  tryon'+(i+1)+' FAIL', e.message); }
}
console.log('DONE');
