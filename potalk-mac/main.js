const { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, net, screen, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { applyPatches } = require('./patch-page');

const HOME = 'https://potalk.app/';
const ORIGIN = new URL(HOME).origin;

async function createWindow() {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  const win = new BrowserWindow({
    width: 520, height: 820, minWidth: 320, minHeight: 300,
    backgroundColor: '#0d1526',
    title: 'ぽっと通話',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  let forceRoom = false, askingRoom = false, unreadChat = 0;
  let chatWin = null, roomWin = null, rsetWin = null, mailWin = null, letterWin = null, letterKey = '', letterDismissed = '', lastSnap = null, lines = [];
  const sendState = () => { if (roomWin) { roomWin.webContents.send('chat-state', !!chatWin); roomWin.webContents.send('mail-state', !!mailWin); } };
  const openChat = () => {
    unreadChat = 0; if (roomWin) roomWin.webContents.send('unread', 0);
    if (chatWin) { chatWin.showInactive(); return; }
    // 本体に重ならないよう、本体の右隣（入りきらなければ画面右端）に置く
    const mb = (roomWin || win).getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 340, h = 460;
    const x = Math.min(mb.x + mb.width + 8, wa.x + wa.width - w);
    const y = Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h);
    chatWin = new BrowserWindow({
      x, y, show: false, width: w, height: h, minWidth: 260, minHeight: 240, alwaysOnTop: true,
      backgroundColor: '#0d1526', title: 'ひとこと',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'chat-preload.js') },
    });
    chatWin.once('ready-to-show', () => chatWin && chatWin.showInactive());
    chatWin.loadFile(path.join(__dirname, 'chat.html'));
    chatWin.webContents.on('did-finish-load', () => chatWin && chatWin.webContents.send('lines', lines));
    chatWin.on('closed', () => { chatWin = null; if (!win.isDestroyed()) sendState(); });
    sendState();
  };
  const mine = e => e.sender === win.webContents;
  ipcMain.on('potalk:chat-toggle', e => { if (!(roomWin && e.sender === roomWin.webContents)) return; chatWin ? chatWin.close() : openChat(); });
  ipcMain.on('potalk:chat-open', e => { if (mine(e)) openChat(); });
  ipcMain.on('potalk:chat-close', e => { if (!mine(e)) return; lines = []; unreadChat = 0; if (chatWin) chatWin.close(); });
  ipcMain.on('potalk:chat-line', (e, l) => {
    if (!mine(e)) return;
    lines.push(l); if (lines.length > 100) lines.shift();
    chatWin && chatWin.webContents.send('line', l);
    // ひとこと窓を閉じている間に届いた（自分以外の）ひとこと＝新着。小窓のボタンを目立たせる
    if (!chatWin && !l.hist && !l.sys && !/（あなた）/.test(l.who || '')) { unreadChat++; roomWin && roomWin.webContents.send('unread', unreadChat); }
  });
  // ひとこと内のリンク：見知らぬ相手が貼ったものなので、開く前に行き先を確認する
  ipcMain.on('potalk:open-link', (e, u) => {
    const okSender = (chatWin && e.sender === chatWin.webContents) || (roomWin && e.sender === roomWin.webContents);
    if (!okSender || typeof u !== 'string') return;
    let url; try { url = new URL(u); } catch { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    dialog.showMessageBox((roomWin && e.sender === roomWin.webContents) ? roomWin : chatWin, {
      type: 'question', buttons: ['ブラウザで開く', 'キャンセル'], defaultId: 1, cancelId: 1,
      message: 'このリンクを開きますか？', detail: url.href.slice(0, 300),
    }).then(r => { if (r.response === 0) shell.openExternal(url.href); });
  });
  ipcMain.on('potalk:chat-send', (e, text) => {
    if (chatWin && e.sender === chatWin.webContents && typeof text === 'string') win.webContents.send('potalk:send', text);
  });
  win.on('closed', () => { if (chatWin) chatWin.close(); if (letterWin) letterWin.close(); closeRoom(); });
  // 部屋の小窓。本体は一覧のまま、入室中の部屋の様子と操作（ミュート・リアクション・リンク・退出）をここに出す
  app.on('before-quit', () => { forceRoom = true; });
  // 公開されたお便り：別の最前面ウィンドウに大きく出す（公開が終わる・部屋を出ると閉じる。×で閉じたら次のお便りまで出さない）
  const openLetter = () => {
    const wa = screen.getDisplayMatching(win.getBounds()).workArea, w = 440, h = 250;
    letterWin = new BrowserWindow({
      x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 60, width: w, height: h, minWidth: 300, minHeight: 160,
      show: false, alwaysOnTop: true, backgroundColor: '#0d1526', title: '公開中のお便り',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
    });
    letterWin.setAlwaysOnTop(true, 'floating');
    letterWin.once('ready-to-show', () => letterWin && letterWin.showInactive());
    letterWin.loadFile(path.join(__dirname, 'letter.html'));
    letterWin.webContents.on('did-finish-load', () => { if (letterWin && lastSnap) letterWin.webContents.send('state', lastSnap); });
    letterWin.on('closed', () => { if (letterKey) letterDismissed = letterKey; letterWin = null; });
  };
  const syncLetter = s => {
    const n = s && s.mailNow, key = n ? JSON.stringify(n) : '';
    if (!key) { letterKey = ''; letterDismissed = ''; if (letterWin) letterWin.close(); return; }
    letterKey = key;
    if (key !== letterDismissed && !letterWin) openLetter();
  };
  const closeRoom = () => { if (roomWin) { forceRoom = true; roomWin.close(); } };
  const openRoom = () => {
    if (roomWin) { roomWin.show(); return; }
    const mb = win.getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 360, h = Math.min(700, wa.height);
    roomWin = new BrowserWindow({
      x: Math.min(mb.x + mb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h),
      width: w, height: h, minWidth: 300, minHeight: 640, alwaysOnTop: true, show: false,
      backgroundColor: '#0d1526', title: '部屋',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
    });
    roomWin.setAlwaysOnTop(true, 'floating');
    roomWin.once('ready-to-show', () => roomWin && roomWin.showInactive());
    roomWin.loadFile(path.join(__dirname, 'room.html'));
    roomWin.webContents.on('did-finish-load', () => {
      if (!roomWin) return;
      if (lastSnap) roomWin.webContents.send('state', lastSnap);
      roomWin.webContents.send('pin', roomWin.isAlwaysOnTop());
      sendState();
    });
    // 小窓を閉じる＝部屋を退出。確認してから退出し、閉じる
    roomWin.on('close', e => {
      if (forceRoom) return;
      e.preventDefault();
      if (askingRoom) return;
      askingRoom = true;
      dialog.showMessageBox(roomWin, {
        type: 'question', buttons: ['退出して閉じる', 'キャンセル'], defaultId: 1, cancelId: 1,
        message: 'この部屋を退出しますか？', detail: '小窓を閉じると、部屋から退出します。',
      }).then(r => {
        askingRoom = false;
        if (r.response === 0 && roomWin) { win.webContents.send('potalk:room-cmd', { type: 'leave' }); closeRoom(); }
      });
    });
    roomWin.on('closed', () => { roomWin = null; forceRoom = false; if (letterWin) letterWin.close(); letterDismissed = ''; if (chatWin) chatWin.close(); if (rsetWin) rsetWin.close(); if (mailWin) mailWin.close(); });
  };
  const fromRoom = e => (roomWin && e.sender === roomWin.webContents) || (rsetWin && e.sender === rsetWin.webContents) || (mailWin && e.sender === mailWin.webContents);
  ipcMain.on('potalk:room-open', e => { if (mine(e)) openRoom(); });
  ipcMain.on('potalk:room-close', e => { if (mine(e)) closeRoom(); });
  // 新しい部屋ができたとき（通知ボタンがオンのとき）：Mac の通知。通知を押すと本体を前に出す
  ipcMain.on('potalk:new-room', (e, name) => {
    if (!mine(e) || typeof name !== 'string' || !Notification.isSupported()) return;
    const n = new Notification({ title: '新しい部屋ができました', body: name || '部屋', silent: false });
    n.on('click', () => { win.show(); win.focus(); });
    n.show();
  });
  // 配信者側：聞き役が手を挙げたら（メンバーの印 🙋 が増えたら）通知音を鳴らす
  let lastHands = 0, lastDing = 0;
  const handsOf = s => ((s && s.members) || []).filter(x => x.mark === '🙋').length;
  const ding = () => {
    if (Date.now() - lastDing < 1000) return;
    lastDing = Date.now();
    execFile('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], err => { if (err) shell.beep(); });
  };
  ipcMain.on('potalk:room-state', (e, s) => { if (!mine(e)) return;
    const hands = s && s.joined ? handsOf(s) : 0;
    if (hands > lastHands) ding();
    lastHands = hands;
    lastSnap = s; roomWin && roomWin.webContents.send('state', s); rsetWin && rsetWin.webContents.send('state', s); mailWin && mailWin.webContents.send('state', s); letterWin && letterWin.webContents.send('state', s); syncLetter(s); });
  ipcMain.on('potalk:room-eq', (e, s) => { if (mine(e) && roomWin && typeof s === 'string') roomWin.webContents.send('eq', s.slice(0, 80)); });
  ipcMain.on('potalk:room-react', (e, r) => { if (mine(e) && roomWin && r && typeof r.e === 'string') roomWin.webContents.send('react', { u: String(r.u), e: r.e.slice(0, 8), n: String(r.n || '').slice(0, 40) }); });
  ipcMain.on('potalk:room-cmd', (e, c) => { if (fromRoom(e) && c && typeof c.type === 'string') win.webContents.send('potalk:room-cmd', c); });
  ipcMain.on('potalk:room-copy', e => {
    if (!fromRoom(e) || !lastSnap || !lastSnap.share) return;
    clipboard.writeText(String(lastSnap.share)); roomWin.webContents.send('copied');
  });
  // 部屋の設定（音量・BGMなど）。本体は変えず、新しいウィンドウに同じ項目を出して、操作は本体のページに流す
  ipcMain.on('potalk:rset-open', e => {
    if (!roomWin || e.sender !== roomWin.webContents) return;
    if (rsetWin) { rsetWin.show(); rsetWin.focus(); return; }
    const rb = roomWin.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 340, h = 460;
    rsetWin = new BrowserWindow({
      x: Math.max(wa.x, Math.min(rb.x - w - 8, wa.x + wa.width - w)), y: Math.min(Math.max(rb.y, wa.y), wa.y + wa.height - h),
      width: w, height: h, minWidth: 280, minHeight: 240, alwaysOnTop: true, backgroundColor: '#0d1526', title: '部屋の設定',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
    });
    rsetWin.setAlwaysOnTop(true, 'floating');
    rsetWin.loadFile(path.join(__dirname, 'rset.html'));
    rsetWin.webContents.on('did-finish-load', () => { if (rsetWin && lastSnap) rsetWin.webContents.send('state', lastSnap); });
    rsetWin.on('closed', () => { rsetWin = null; });
  });
  // おたより。設定とは別のウィンドウ（配信部屋のときだけ小窓にボタンが出る）
  ipcMain.on('potalk:mail-open', e => {
    if (!roomWin || e.sender !== roomWin.webContents) return;
    if (mailWin) { mailWin.show(); mailWin.focus(); return; }
    const rb = roomWin.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 360, h = 480;
    mailWin = new BrowserWindow({
      x: Math.min(rb.x + rb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(rb.y + 40, wa.y), wa.y + wa.height - h),
      width: w, height: h, minWidth: 300, minHeight: 280, alwaysOnTop: true, backgroundColor: '#0d1526', title: 'おたより',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
    });
    mailWin.setAlwaysOnTop(true, 'floating');
    mailWin.loadFile(path.join(__dirname, 'mail.html'));
    mailWin.webContents.on('did-finish-load', () => { if (mailWin && lastSnap) mailWin.webContents.send('state', lastSnap); });
    mailWin.on('closed', () => { mailWin = null; sendState(); });
    sendState();
  });
  ipcMain.on('potalk:room-pin', e => {
    if (!fromRoom(e)) return;
    roomWin.setAlwaysOnTop(!roomWin.isAlwaysOnTop(), 'floating');
    roomWin.webContents.send('pin', roomWin.isAlwaysOnTop());
  });
  // 初期設定（名前・アバター・見た目）。同じページを設定だけの表示で開く。保存先(localStorage)は本体と共通
  let settingsWin = null;
  const openSettings = () => {
    if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
    settingsWin = new BrowserWindow({
      width: 480, height: 680, minWidth: 360, minHeight: 400, title: 'ぽっと通話：初期設定',
      backgroundColor: '#0d1526', parent: win,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--pm-role=settings'] },
    });
    settingsWin.loadURL(HOME);
    settingsWin.on('closed', () => { settingsWin = null; if (!win.isDestroyed()) win.webContents.send('potalk:profile-changed'); });
  };
  ipcMain.on('potalk:settings-open', e => { if (mine(e)) openSettings(); });
  win.on('closed', () => { if (settingsWin) settingsWin.close(); });
  // 部屋づくりの小窓。入力だけをここで受け取り、本体のページに流し込んで「部屋を作る」を押す
  let createWin = null;
  ipcMain.on('potalk:create-open', (e, def) => {
    if (!mine(e)) return;
    if (createWin) { createWin.show(); createWin.focus(); return; }
    createWin = new BrowserWindow({
      width: 400, height: 340, resizable: false, parent: win, title: '部屋を作る', backgroundColor: '#0d1526',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'chat-preload.js') },
    });
    createWin.loadFile(path.join(__dirname, 'create.html'));
    createWin.webContents.on('did-finish-load', () => createWin && createWin.webContents.send('default', String(def || '').slice(0, 30)));
    createWin.on('closed', () => { createWin = null; });
  });
  ipcMain.on('potalk:create-submit', (e, v) => {
    if (!createWin || e.sender !== createWin.webContents || !v || typeof v.name !== 'string' || !v.name.trim()) return;
    win.webContents.send('potalk:create', { name: v.name.trim().slice(0, 30), kind: v.kind === 'bc' ? 'bc' : 'chat' });
    createWin.close();
  });
  ipcMain.on('potalk:create-close', e => { if (mine(e) && createWin) createWin.close(); });
  win.on('closed', () => { if (createWin) createWin.close(); });
  // 「これはなに？」の説明。同じページの説明ダイアログだけを別ウィンドウに出す（リンクは既定のブラウザで開く）
  let helpWin = null;
  ipcMain.on('potalk:help-open', e => {
    if (!mine(e)) return;
    if (helpWin) { helpWin.show(); helpWin.focus(); return; }
    helpWin = new BrowserWindow({
      width: 440, height: 720, minWidth: 320, minHeight: 360, title: 'ぽっと通話：これはなに？',
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), additionalArguments: ['--pm-role=help'] },
    });
    helpWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    helpWin.loadURL(HOME);
    helpWin.on('closed', () => { helpWin = null; });
  });
  ipcMain.on('potalk:help-closed', e => { if (helpWin && e.sender === helpWin.webContents) helpWin.close(); });
  win.on('closed', () => { if (helpWin) helpWin.close(); });
  // 読み込めない・描画プロセスが落ちたときに真っ暗なままにしない
  const OFFLINE = path.join(__dirname, 'offline.html');
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) win.loadFile(OFFLINE); });
  win.webContents.on('render-process-gone', () => win.loadURL(HOME));
  win.loadURL(HOME);
  const marker = path.join(app.getPath('userData'), 'settings-shown');
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); win.webContents.once('did-finish-load', openSettings); }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === ORIGIN) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  // potalk.app のトップページだけ取得して差し込みを当てる（保存先 localStorage の origin はそのまま）。
  // 差し込み位置が見つからない／取得に失敗したときは、元のページをそのまま渡す。
  session.defaultSession.protocol.handle('https', async req => {
    const u = new URL(req.url);
    const passthrough = () => net.fetch(req, { bypassCustomProtocolHandlers: true });
    if (u.hostname !== ORIGIN.replace('https://', '') || req.method !== 'GET' || !(u.pathname === '/' || u.pathname === '/index.html')) return passthrough();
    try {
      const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
      const r = applyPatches(await res.text());
      if (!r.applied) console.error('[potalk-mac] 差し込み位置が見つかりません。元のページを使います:', r.missing);
      const headers = new Headers(res.headers); headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(r.html, { status: res.status, headers });
    } catch { return passthrough(); }
  });
  const allowed = ['media', 'audioCapture', 'clipboard-sanitized-write', 'fullscreen'];
  const ok = (wc, perm, origin) => allowed.includes(perm) && new URL(origin || wc.getURL()).origin === ORIGIN;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(ok(wc, perm, d.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ok(wc, perm, origin));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});
app.on('window-all-closed', () => app.quit());
