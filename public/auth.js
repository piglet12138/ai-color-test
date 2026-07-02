// 共享用户系统：登录/注册/退出 widget + saveHistory。所有页面 include。
(function () {
  const LS = 'csd_token';
  const A = window.CSDAuth = { user: null, token: localStorage.getItem(LS) || '' };
  async function api(path, method = 'GET', body) {
    const h = { 'Content-Type': 'application/json' }; if (A.token) h['x-token'] = A.token;
    const r = await fetch(path.replace(/^\//, ''), { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d;
  }
  A.api = api;
  A.saveHistory = async function (entry) { if (!A.token) return; try { await api('/api/history', 'POST', entry); toast('已保存到「我的历史」'); } catch (e) {} };

  const bar = document.createElement('div'); bar.className = 'auth-bar'; document.body.appendChild(bar);
  function render() {
    if (A.user) {
      bar.innerHTML = `<span>👤 ${A.user}</span> · <a href="me.html">我的历史</a> · <a href="#" id="lo">退出</a>`;
      bar.querySelector('#lo').onclick = async (e) => { e.preventDefault(); try { await api('/api/auth/logout', 'POST'); } catch {} A.token = ''; A.user = null; localStorage.removeItem(LS); render(); };
    } else {
      bar.innerHTML = `<a href="#" id="li">登录 / 注册</a>`;
      bar.querySelector('#li').onclick = (e) => { e.preventDefault(); modal(); };
    }
  }
  function modal(onDone) {
    const m = document.createElement('div'); m.className = 'auth-modal';
    m.innerHTML = `<div class="auth-box">
      <div class="auth-tabs"><b id="tl" class="on">登录</b><b id="tr">注册</b></div>
      <input id="au" placeholder="用户名" autocomplete="username">
      <input id="ap" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password">
      <div id="ae" class="auth-err"></div>
      <button id="ok" class="primary">登录</button>
      <a href="#" id="cx" class="auth-cancel">取消</a></div>`;
    document.body.appendChild(m);
    let mode = 'login';
    const set = (x) => { mode = x; m.querySelector('#tl').classList.toggle('on', x === 'login'); m.querySelector('#tr').classList.toggle('on', x === 'register'); m.querySelector('#ok').textContent = x === 'login' ? '登录' : '注册'; };
    m.querySelector('#tl').onclick = () => set('login');
    m.querySelector('#tr').onclick = () => set('register');
    m.querySelector('#cx').onclick = (e) => { e.preventDefault(); m.remove(); };
    m.querySelector('#ok').onclick = async () => {
      const u = m.querySelector('#au').value, p = m.querySelector('#ap').value;
      try {
        const d = await api('/api/auth/' + mode, 'POST', { username: u, password: p });
        A.token = d.token; A.user = d.username; localStorage.setItem(LS, d.token);
        m.remove(); render(); toast('欢迎，' + d.username); onDone && onDone();
      } catch (e) { m.querySelector('#ae').textContent = e.message; }
    };
  }
  A.requireLogin = () => new Promise((res) => { if (A.user) return res(true); modal(() => res(true)); });

  function toast(t) {
    let el = document.querySelector('.auth-toast');
    if (!el) { el = document.createElement('div'); el.className = 'auth-toast'; document.body.appendChild(el); }
    el.textContent = t; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2200);
  }
  A.toast = toast;

  render();
  A.ready = A.token ? api('/api/auth/me').then((d) => { A.user = d.username; render(); }).catch(() => { A.token = ''; localStorage.removeItem(LS); render(); }) : Promise.resolve();
})();
