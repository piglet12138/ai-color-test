// 应用内拍照：全屏相机 + 人脸引导框 + 拍照指引；输出原生分辨率 canvas（不压缩、不美颜）。
window.ColorCam = (() => {
  let stream = null, facing = 'user';
  function stop() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

  async function start(video) {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1440 } }, audio: false });
    video.srcObject = stream; await video.play();
  }

  function open(onCapture) {
    const ov = document.createElement('div'); ov.className = 'cam-ov';
    ov.innerHTML = `
      <video class="cam-video" playsinline autoplay muted></video>
      <div class="cam-guide"></div>
      <div class="cam-tips">
        <b>拍照小贴士</b>
        <span>· 面朝<b>自然光</b>（窗边最佳），别逆光/顶光</span>
        <span>· <b>素颜或淡妆</b>，关掉美颜/滤镜</span>
        <span>· 正脸、露出额头，表情放松</span>
        <span>· 有条件举一张 <b>A4 白纸</b> 在下巴附近做校色参照</span>
      </div>
      <div class="cam-bar">
        <button class="cam-btn cam-x">取消</button>
        <button class="cam-shot" aria-label="拍照"></button>
        <button class="cam-btn cam-flip">翻转</button>
      </div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('.cam-video');
    const close = () => { stop(); ov.remove(); };
    ov.querySelector('.cam-x').onclick = close;
    ov.querySelector('.cam-flip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; try { await start(video); } catch (e) {} };
    ov.querySelector('.cam-shot').onclick = () => {
      const w = video.videoWidth, h = video.videoHeight; if (!w) return;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d');
      if (facing === 'user') { cx.translate(w, 0); cx.scale(-1, 1); } // 前置镜像回正
      cx.drawImage(video, 0, 0, w, h);
      close(); onCapture(c);
    };
    start(video).catch((e) => { close(); alert('无法打开相机：' + (e.message || e) + '\n请改用「从相册上传」。'); });
  }
  return { open };
})();
