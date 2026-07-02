// 拍照质量门 (Capture QC) — 浏览器端，跑在色彩分析之前。
// 端口自参考 QC：曝光/清晰度/削波/人脸尺寸 独立门 + WB 置信度 + A4 白纸白平衡。
// 低置信 → 提示前端把 undertone 输出成区间并引导重拍。
window.ColorQC = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // sRGB Y -> CIE L*
  function lstar(y) { const t = y / 255; const yl = t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4; return 116 * (yl > 0.008856 ? Math.cbrt(yl) : 7.787 * yl + 16 / 116) - 16; }
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  function isSkin(r, g, b) { const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b; return luma(r, g, b) > 50 && Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173; }

  // 在 canvas 上评估（canvas 已是待分析图，建议 ~720px）
  function assess(canvas, opts = {}) {
    const ctx = canvas.getContext('2d'); const { width: W, height: H } = canvas;
    const d = ctx.getImageData(0, 0, W, H).data;
    // 皮肤/中部区域曝光 + 削波
    const skinL = []; let clipHi = 0, clipLo = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2]; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx >= 250) clipHi++; if (mn <= 6) clipLo++;
      if (x > W * 0.28 && x < W * 0.72 && y > H * 0.2 && y < H * 0.8 && isSkin(r, g, b)) skinL.push(lstar(luma(r, g, b)));
    }
    const medL = skinL.length ? skinL.sort((a, b) => a - b)[skinL.length >> 1] : 0;
    const fracHi = clipHi / n, fracLo = clipLo / n;
    // 清晰度：灰度拉普拉斯方差（缩到 ~400 宽算，阈值据此校准）
    const lapVar = laplacianVar(canvas);
    const gates = [
      { name: '分辨率', ok: Math.min(opts.srcW || W, opts.srcH || H) >= 600, val: `${opts.srcW || W}×${opts.srcH || H}`, need: '原图短边≥600', tip: '别用缩略图/截图，用原图' },
      { name: '曝光', ok: skinL.length > 40 && medL >= 52 && medL <= 84, val: skinL.length ? `皮肤L*=${medL.toFixed(0)}` : '未取到皮肤', need: '皮肤 L* 52–84', tip: medL && medL < 52 ? '太暗了，找更亮的自然光、正对光源' : medL > 84 ? '过亮，避开强光直射/别贴窗' : '让脸对着柔和自然光' },
      { name: '清晰度', ok: lapVar > 12, val: `锐度=${lapVar.toFixed(0)}`, need: '不糊(锐度>12)', tip: '拿稳手机、等对焦清晰再拍' },
      { name: '过曝削波', ok: fracHi < 0.06, val: `高光削波=${(fracHi * 100).toFixed(1)}%`, need: '<6%', tip: '避开背后强光/逆光，别开闪光灯' },
    ];
    const refValid = !!opts.wbRefValid; // 是否用了有效白纸参照
    let conf = 0.5;
    if (refValid) conf += 0.35;
    if (!gates[1].ok) conf -= 0.2;        // 曝光
    if (!gates[3].ok) conf -= 0.2;        // 削波
    if (!gates[2].ok) conf -= 0.15;       // 糊
    if (opts.mixedLight) conf -= 0.15;
    conf = clamp(conf, 0, 1);
    const coreOk = gates.filter((g) => g.ok).length >= 3;
    const verdict = conf >= 0.6 && coreOk ? 'good' : conf >= 0.3 ? 'edge' : 'bad';
    const reshoot = gates.filter((g) => !g.ok).map((g) => g.tip);
    return { gates, wb_conf: +conf.toFixed(2), verdict, reshoot, skinL: medL };
  }

  function laplacianVar(canvas) {
    const s = 400, sc = Math.min(1, s / canvas.width);
    const w = Math.round(canvas.width * sc), h = Math.round(canvas.height * sc);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d'); cx.drawImage(canvas, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const gray = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    let sum = 0, sum2 = 0, m = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap; sum2 += lap * lap; m++;
    }
    return m ? sum2 / m - (sum / m) ** 2 : 0;
  }

  // A4 白纸白平衡：给白纸区域(相对坐标 0..1 的 {x,y,w,h})，灰世界拉回中性，返回校正后 canvas + gain
  function whiteBalance(srcCanvas, patch) {
    const ctx = srcCanvas.getContext('2d'); const { width: W, height: H } = srcCanvas;
    const px = Math.round(patch.x * W), py = Math.round(patch.y * H), pw = Math.max(4, Math.round(patch.w * W)), ph = Math.max(4, Math.round(patch.h * H));
    const p = ctx.getImageData(px, py, pw, ph).data;
    let R = 0, G = 0, B = 0, k = 0;
    for (let i = 0; i < p.length; i += 4) { R += p[i]; G += p[i + 1]; B += p[i + 2]; k++; }
    R /= k; G /= k; B /= k;
    const chroma = Math.hypot(...srgbAB(R, G, B));
    const valid = k > 50 && Math.min(R, G, B) > 90 && Math.max(R, G, B) < 252 && chroma < 22; // 是白/灰纸且未削波
    const gG = G;
    const gain = [gG / Math.max(1, R), 1, gG / Math.max(1, B)];
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d'); octx.drawImage(srcCanvas, 0, 0);
    const id = octx.getImageData(0, 0, W, H); const dd = id.data;
    for (let i = 0; i < dd.length; i += 4) { dd[i] = clamp(dd[i] * gain[0], 0, 255); dd[i + 2] = clamp(dd[i + 2] * gain[2], 0, 255); }
    octx.putImageData(id, 0, 0);
    return { canvas: out, gain, valid, note: valid ? `白纸校正 gain=[${gain[0].toFixed(2)},1,${gain[2].toFixed(2)}]` : '白纸区域不合格（可能不是白/灰或过曝），未采用' };
  }
  function srgbAB(r, g, b) { // 近似 a*,b*（判纸是否中性用）
    const f = (t) => { t /= 255; return t > 0.04045 ? ((t + 0.055) / 1.055) ** 2.4 : t / 12.92; };
    const R = f(r), Gg = f(g), Bb = f(b);
    let X = (R * 0.4124 + Gg * 0.3576 + Bb * 0.1805) / 0.95047, Y = R * 0.2126 + Gg * 0.7152 + Bb * 0.0722, Z = (R * 0.0193 + Gg * 0.1192 + Bb * 0.9505) / 1.08883;
    const c = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    X = c(X); Y = c(Y); Z = c(Z);
    return [500 * (X - Y), 200 * (Y - Z)];
  }
  // 自动找画面里的白/灰纸参照：扫网格取「亮、低色度、未削波、够大」的最佳块
  function findWhitePatch(canvas) {
    const ctx = canvas.getContext('2d'); const { width: W, height: H } = canvas;
    let best = null;
    const gx = 6, gy = 8, pw = 1 / gx, ph = 1 / gy;
    for (let iy = 0; iy < gy; iy++) for (let ix = 0; ix < gx; ix++) {
      const x = ix / gx, y = iy / gy;
      const px = Math.round(x * W), py = Math.round(y * H), w = Math.round(pw * W), h = Math.round(ph * H);
      const p = ctx.getImageData(px, py, w, h).data;
      let R = 0, G = 0, B = 0, k = 0, clip = 0;
      for (let i = 0; i < p.length; i += 4) { R += p[i]; G += p[i + 1]; B += p[i + 2]; if (Math.max(p[i], p[i + 1], p[i + 2]) >= 252) clip++; k++; }
      R /= k; G /= k; B /= k;
      const bright = (R + G + B) / 3, chroma = Math.hypot(...srgbAB(R, G, B)), clipFrac = clip / k;
      if (bright > 150 && bright < 250 && chroma < 14 && clipFrac < 0.1) {
        const score = bright - chroma * 6; // 亮且中性优先
        if (!best || score > best.score) best = { score, patch: { x, y, w: pw, h: ph } };
      }
    }
    return best ? best.patch : null;
  }
  return { assess, whiteBalance, findWhitePatch };
})();
