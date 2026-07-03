// 浏览器端「CV 预处理」：从自拍提取肤/发主色 + CIELAB 测量 + 整体色板（k-means）
// 对应技术方案 §2.1：人脸区域主色提取 → hex，喂给文本 LLM 推理。
window.ColorCV = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // sRGB → CIELAB
  function rgb2lab(r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    [R, G, B] = [R, G, B].map((c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92));
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    [X, Y, Z] = [X, Y, Z].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // 皮肤判定（YCbCr 经验阈值）
  function isSkin(r, g, b) {
    const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const Y = luma(r, g, b);
    return Y > 50 && Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173;
  }

  function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1] || 0; }

  // 极简 k-means（取整体主色板）
  function kmeans(pixels, k = 6, iters = 8) {
    if (pixels.length < k) return [];
    let cent = [];
    for (let i = 0; i < k; i++) cent.push(pixels[Math.floor((i + 0.5) / k * pixels.length)]);
    let assign = new Array(pixels.length).fill(0);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < pixels.length; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = pixels[i][0] - cent[c][0], dg = pixels[i][1] - cent[c][1], db = pixels[i][2] - cent[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = c; }
        }
        assign[i] = best;
      }
      const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
      for (let i = 0; i < pixels.length; i++) {
        const c = assign[i]; sum[c][0] += pixels[i][0]; sum[c][1] += pixels[i][1]; sum[c][2] += pixels[i][2]; sum[c][3]++;
      }
      cent = sum.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[i]));
    }
    const counts = new Array(k).fill(0); assign.forEach((a) => counts[a]++);
    return cent.map((c, i) => ({ rgb: c, n: counts[i] }))
      .filter((c) => c.n > pixels.length * 0.03)
      .sort((a, b) => b.n - a.n)
      .map((c) => toHex(c.rgb[0], c.rgb[1], c.rgb[2]));
  }

  // 主流程：在 canvas 上分析（已缩放）
  function analyze(canvas) {
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const data = ctx.getImageData(0, 0, W, H).data;

    const skin = [[], [], []]; const hairCand = []; const all = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 128) continue;
        all.push([r, g, b]);
        // 肤色：集中在中部区域更可信
        if (y > H * 0.2 && y < H * 0.85 && isSkin(r, g, b)) { skin[0].push(r); skin[1].push(g); skin[2].push(b); }
        // 发色候选：上 45% 行、且在中部列（避开背景四角）里偏暗的像素
        if (y < H * 0.45 && x > W * 0.2 && x < W * 0.8) hairCand.push([r, g, b, luma(r, g, b)]);
      }
    }

    // 肤色 = skin 像素中位
    let skinHex = '#d8b89c', skinLab = [70, 8, 16];
    if (skin[0].length > 30) {
      const sr = median(skin[0]), sg = median(skin[1]), sb = median(skin[2]);
      skinHex = toHex(sr, sg, sb); skinLab = rgb2lab(sr, sg, sb);
    }
    // 发色 = 上部最暗 35% 的均值
    let hairHex = '#2b2118', hairLab = [18, 2, 4];
    if (hairCand.length > 30) {
      hairCand.sort((a, b) => a[3] - b[3]); // 按亮度升序，取最暗的一撮当发色
      const dark = hairCand.slice(0, Math.max(20, Math.floor(hairCand.length * 0.18)));
      const m = dark.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / dark.length);
      hairHex = toHex(m[0], m[1], m[2]); hairLab = rgb2lab(m[0], m[1], m[2]);
    }

    const palette = kmeans(all.filter((_, i) => i % 3 === 0), 6); // 抽样加速
    return {
      skinHex, skinL: Math.round(skinLab[0]), skinA: Math.round(skinLab[1]), skinB: Math.round(skinLab[2]),
      hairHex, hairL: Math.round(hairLab[0]),
      contrast: Math.round(Math.abs(skinLab[0] - hairLab[0])),
      palette,
    };
  }

  // 核心：从可绘制源(img/canvas)产出 {features, thumbURL(384jpeg), editURL(768png)}
  function build(source, sw, sh, canvas) {
    const max = 384, scale = Math.min(1, max / Math.max(sw, sh));
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const features = analyze(canvas);
    const thumbURL = canvas.toDataURL('image/jpeg', 0.85);
    const emax = 768, es = Math.min(1, emax / Math.max(sw, sh));
    const ec = document.createElement('canvas');
    ec.width = Math.round(sw * es); ec.height = Math.round(sh * es);
    ec.getContext('2d').drawImage(source, 0, 0, ec.width, ec.height);
    return { features, thumbURL, editURL: ec.toDataURL('image/jpeg', 0.9) }; // JPEG：比 PNG 小很多，编码更快、更省缓存`
  }
  function fromFile(file, canvas) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(build(img, img.naturalWidth, img.naturalHeight, canvas));
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = URL.createObjectURL(file);
    });
  }
  // 从（已可能白平衡校正过的）canvas 直接建
  function fromCanvas(srcCanvas, canvas) {
    return Promise.resolve(build(srcCanvas, srcCanvas.width, srcCanvas.height, canvas));
  }

  return { fromFile, fromCanvas };
})();
