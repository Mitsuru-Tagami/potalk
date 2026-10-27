const { app, BrowserWindow, BrowserView, Menu, Notification, clipboard, dialog, ipcMain, net, screen, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { applyPatches } = require('./patch-page');

const HOME = 'https://potalk.app/';
const ORIGIN = new URL(HOME).origin;

// ウィンドウモード：unified=左の縦タブで右ペインを切り替える統合ウィンドウ、
// split=本体＋個別の小窓（従来の形）。切り替えはメニューから選び、再起動で適用する。
const RAIL_WIDTH = 76;
let uiMode = 'split';
const modeFile = () => path.join(app.getPath('userData'), 'ui-mode.json');
function loadUiMode() {
  try {
    const m = JSON.parse(fs.readFileSync(modeFile(), 'utf8'));
    return m && m.mode === 'unified' ? 'unified' : 'split';
  } catch { return 'split'; }
}
function requestModeChange(mode) {
  if (mode === uiMode) return;
  try { fs.writeFileSync(modeFile(), JSON.stringify({ mode })); } catch {}
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  dialog.showMessageBox(w, {
    type: 'question', buttons: ['再起動して適用', 'あとで'], defaultId: 0, cancelId: 1,
    message: 'ウィンドウモードを切り替えますか？',
    detail: '通話中の場合は切断されます。アプリを再起動すると、新しいモードで起動します。',
  }).then(r => { if (r.response === 0) { app.relaunch(); app.exit(0); } });
}
function buildMenu() {
  const modeItem = m => ({
    label: m === 'unified' ? '統合（左タブで切り替え）' : 'バラバラ（個別ウィンドウ）',
    type: 'radio', checked: uiMode === m, click: () => requestModeChange(m),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: '表示',
      submenu: [
        modeItem('unified'), modeItem('split'), { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

async function createWindow() {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  const unified = uiMode === 'unified';
  // win は OS のウィンドウ（split=本体そのもの、unified=タブの器になるシェル）。
  // 本体のページは split では win 自身、unified では pageView が持つ。
  let win, pageView = null;
  if (unified) {
    win = new BrowserWindow({
      width: 1100, height: 820, minWidth: 560, minHeight: 400,
      backgroundColor: '#0d1526',
      title: 'Potalker（ぽっと通話 非公式クライアント）',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'shell-preload.js') },
    });
    pageView = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    win.loadFile(path.join(__dirname, 'shell.html'));
  } else {
    win = new BrowserWindow({
      width: 520, height: 820, minWidth: 320, minHeight: 300,
      backgroundColor: '#0d1526',
      title: 'Potalker（ぽっと通話 非公式クライアント）',
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
  }
  const pageWC = () => (pageView ? pageView.webContents : win.webContents);

  let forceRoom = false, askingRoom = false, unreadChat = 0;
  let chatWin = null, roomWin = null, rsetWin = null, mailWin = null, letterWin = null, letterKey = '', letterDismissed = '', lastSnap = null, lines = [];

  // パネル（部屋・ひとこと・おたより・部屋設定）の受け皿。
  // split では個別ウィンドウ、unified ではシェル内のビューとして作り、同じ顔つきで扱う。
  const views = { page: pageView, room: null, chat: null, mail: null, rset: null };
  let currentTab = 'page';
  const layoutView = v => {
    if (!v || win.isDestroyed()) return;
    const b = win.getContentBounds();
    v.setBounds({ x: RAIL_WIDTH, y: 0, width: Math.max(0, b.width - RAIL_WIDTH), height: b.height });
  };
  const attachView = v => { if (v && !win.isDestroyed() && !win.getBrowserViews().includes(v)) { win.addBrowserView(v); layoutView(v); } };
  const detachView = v => { if (v && !win.isDestroyed() && win.getBrowserViews().includes(v)) win.removeBrowserView(v); };
  const sendShellState = () => {
    if (unified && !win.isDestroyed()) win.webContents.send('shell:state', { tab: currentTab, unread: unreadChat, inRoom: !!roomWin });
  };
  function selectTab(tab) {
    if (!unified) return;
    if ((tab === 'room' && !roomWin) || (tab === 'mail' && !mailWin) || (tab === 'rset' && !rsetWin)) tab = 'page';
    currentTab = tab;
    for (const [k, v] of Object.entries(views)) { if (v) (k === tab ? attachView : detachView)(v); }
    if (tab === 'chat') { unreadChat = 0; if (roomWin) roomWin.wc.send('unread', 0); }
    sendShellState();
  }
  function destroyView(tab) {
    const v = views[tab];
    if (!v) return;
    views[tab] = null;
    detachView(v);
    if (currentTab === tab) { currentTab = 'page'; attachView(pageView); }
    if (!v.webContents.isDestroyed()) v.webContents.destroy();
    sendShellState();
  }
  const viewHost = (tab, file, preload) => {
    const view = new BrowserView({
      webPreferences: { contextIsolation: true, sandbox: true, preload, backgroundThrottling: false },
    });
    views[tab] = view;
    view.webContents.loadFile(file);
    return {
      wc: view.webContents, view, win: null,
      show() { selectTab(tab); }, showInactive() { selectTab(tab); }, focus() { selectTab(tab); },
      close() { destroyView(tab); },
      onClosed(f) { view.webContents.once('destroyed', f); },
      loadFile(f) { view.webContents.loadFile(f); },
    };
  };
  const windowHost = w => ({
    wc: w.webContents, win: w, view: null,
    show() { if (!w.isDestroyed()) w.show(); },
    showInactive() { if (!w.isDestroyed()) w.showInactive(); },
    focus() { if (!w.isDestroyed()) w.focus(); },
    close() { if (!w.isDestroyed()) w.close(); },
    onClosed(f) { w.on('closed', f); },
    loadFile(f) { w.loadFile(f); },
  });

  const sendState = () => { if (roomWin) { roomWin.wc.send('chat-state', !!chatWin); roomWin.wc.send('mail-state', !!mailWin); } };
  const openChat = () => {
    unreadChat = 0; if (roomWin) roomWin.wc.send('unread', 0);
    if (chatWin) { chatWin.showInactive(); return; }
    if (unified) {
      chatWin = viewHost('chat', path.join(__dirname, 'chat.html'), path.join(__dirname, 'chat-preload.js'));
    } else {
      // 本体に重ならないよう、本体の右隣（入りきらなければ画面右端）に置く
      const mb = (roomWin ? roomWin.win : win).getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 340, h = 460;
      const x = Math.min(mb.x + mb.width + 8, wa.x + wa.width - w);
      const y = Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h);
      const cw = new BrowserWindow({
        x, y, show: false, width: w, height: h, minWidth: 260, minHeight: 240, alwaysOnTop: true,
        backgroundColor: '#0d1526', title: 'ひとこと',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'chat-preload.js') },
      });
      cw.once('ready-to-show', () => chatWin && chatWin.showInactive());
      chatWin = windowHost(cw);
      chatWin.loadFile(path.join(__dirname, 'chat.html'));
    }
    chatWin.wc.on('did-finish-load', () => chatWin && chatWin.wc.send('lines', lines));
    chatWin.onClosed(() => { chatWin = null; if (!win.isDestroyed()) sendState(); sendShellState(); });
    if (unified) selectTab('chat');
    sendState();
  };
  const mine = e => e.sender === pageWC();
  ipcMain.on('potalk:chat-toggle', e => { if (!(roomWin && e.sender === roomWin.wc)) return; if (unified) { currentTab === 'chat' ? selectTab('room') : openChat(); } else { chatWin ? chatWin.close() : openChat(); } });
  ipcMain.on('potalk:chat-open', e => { if (mine(e)) openChat(); });
  ipcMain.on('potalk:chat-close', e => { if (!mine(e)) return; lines = []; unreadChat = 0; if (chatWin) chatWin.close(); });
  ipcMain.on('potalk:chat-line', (e, l) => {
    if (!mine(e)) return;
    lines.push(l); if (lines.length > 100) lines.shift();
    chatWin && chatWin.wc.send('line', l);
    // ひとこと窓を閉じている間に届いた（自分以外の）ひとこと＝新着。小窓のボタンを目立たせる
    if (!chatWin && !l.hist && !l.sys && !/（あなた）/.test(l.who || '')) { unreadChat++; roomWin && roomWin.wc.send('unread', unreadChat); sendShellState(); }
  });
  // ひとこと内のリンク：見知らぬ相手が貼ったものなので、開く前に行き先を確認する
  ipcMain.on('potalk:open-link', (e, u) => {
    const okSender = (chatWin && e.sender === chatWin.wc) || (roomWin && e.sender === roomWin.wc);
    if (!okSender || typeof u !== 'string') return;
    let url; try { url = new URL(u); } catch { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    dialog.showMessageBox(unified ? win : ((roomWin && e.sender === roomWin.wc) ? roomWin.win : chatWin.win), {
      type: 'question', buttons: ['ブラウザで開く', 'キャンセル'], defaultId: 1, cancelId: 1,
      message: 'このリンクを開きますか？', detail: url.href.slice(0, 300),
    }).then(r => { if (r.response === 0) shell.openExternal(url.href); });
  });
  ipcMain.on('potalk:chat-send', (e, text) => {
    if (chatWin && e.sender === chatWin.wc && typeof text === 'string') pageWC().send('potalk:send', text);
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
    if (unified) {
      roomWin = viewHost('room', path.join(__dirname, 'room.html'), path.join(__dirname, 'room-preload.js'));
    } else {
      const mb = win.getBounds(), wa = screen.getDisplayMatching(mb).workArea, w = 360, h = Math.min(700, wa.height);
      const rw = new BrowserWindow({
        x: Math.min(mb.x + mb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(mb.y, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 300, minHeight: 640, alwaysOnTop: true, show: false,
        backgroundColor: '#0d1526', title: '部屋',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      rw.setAlwaysOnTop(true, 'floating');
      rw.once('ready-to-show', () => roomWin && roomWin.showInactive());
      roomWin = windowHost(rw);
      roomWin.loadFile(path.join(__dirname, 'room.html'));
      // 小窓を閉じる＝部屋を退出。確認してから退出し、閉じる
      rw.on('close', e => {
        if (forceRoom) return;
        e.preventDefault();
        if (askingRoom) return;
        askingRoom = true;
        dialog.showMessageBox(rw, {
          type: 'question', buttons: ['退出して閉じる', 'キャンセル'], defaultId: 1, cancelId: 1,
          message: 'この部屋を退出しますか？', detail: '小窓を閉じると、部屋から退出します。',
        }).then(r => {
          askingRoom = false;
          if (r.response === 0 && roomWin) { pageWC().send('potalk:room-cmd', { type: 'leave' }); closeRoom(); }
        });
      });
    }
    roomWin.wc.on('did-finish-load', () => {
      if (!roomWin) return;
      if (lastSnap) roomWin.wc.send('state', lastSnap);
      roomWin.wc.send('pin', unified ? true : roomWin.win.isAlwaysOnTop());
      sendState();
    });
    roomWin.onClosed(() => { roomWin = null; forceRoom = false; if (letterWin) letterWin.close(); letterDismissed = ''; if (chatWin) chatWin.close(); if (rsetWin) rsetWin.close(); if (mailWin) mailWin.close(); sendShellState(); });
    if (unified) selectTab('room');
    sendShellState();
  };
  const fromRoom = e => (roomWin && e.sender === roomWin.wc) || (rsetWin && e.sender === rsetWin.wc) || (mailWin && e.sender === mailWin.wc);
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
    if (process.platform === 'darwin') execFile('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], err => { if (err) shell.beep(); });
    else shell.beep();
  };
  ipcMain.on('potalk:room-state', (e, s) => { if (!mine(e)) return;
    const hands = s && s.joined ? handsOf(s) : 0;
    if (hands > lastHands) ding();
    lastHands = hands;
    lastSnap = s; roomWin && roomWin.wc.send('state', s); rsetWin && rsetWin.wc.send('state', s); mailWin && mailWin.wc.send('state', s); letterWin && letterWin.webContents.send('state', s); syncLetter(s); });
  ipcMain.on('potalk:room-eq', (e, s) => { if (mine(e) && roomWin && typeof s === 'string') roomWin.wc.send('eq', s.slice(0, 80)); });
  ipcMain.on('potalk:room-react', (e, r) => { if (mine(e) && roomWin && r && typeof r.e === 'string') roomWin.wc.send('react', { u: String(r.u), e: r.e.slice(0, 8), n: String(r.n || '').slice(0, 40) }); });
  ipcMain.on('potalk:room-cmd', (e, c) => { if (fromRoom(e) && c && typeof c.type === 'string') pageWC().send('potalk:room-cmd', c); });
  ipcMain.on('potalk:room-copy', e => {
    if (!fromRoom(e) || !lastSnap || !lastSnap.share) return;
    clipboard.writeText(String(lastSnap.share)); roomWin.wc.send('copied');
  });
  // 部屋の設定（音量・BGMなど）。本体は変えず、パネルに同じ項目を出して、操作は本体のページに流す
  const openRset = () => {
    if (rsetWin) { rsetWin.show(); rsetWin.focus(); return; }
    if (unified) {
      rsetWin = viewHost('rset', path.join(__dirname, 'rset.html'), path.join(__dirname, 'room-preload.js'));
    } else {
      const rb = roomWin.win.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 340, h = 460;
      const sw = new BrowserWindow({
        x: Math.max(wa.x, Math.min(rb.x - w - 8, wa.x + wa.width - w)), y: Math.min(Math.max(rb.y, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 280, minHeight: 240, alwaysOnTop: true, backgroundColor: '#0d1526', title: '部屋の設定',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      sw.setAlwaysOnTop(true, 'floating');
      rsetWin = windowHost(sw);
      rsetWin.loadFile(path.join(__dirname, 'rset.html'));
    }
    rsetWin.wc.on('did-finish-load', () => { if (rsetWin && lastSnap) rsetWin.wc.send('state', lastSnap); });
    rsetWin.onClosed(() => { rsetWin = null; sendShellState(); });
    if (unified) selectTab('rset');
    sendShellState();
  };
  ipcMain.on('potalk:rset-open', e => {
    if (!roomWin || e.sender !== roomWin.wc) return;
    openRset();
  });
  // おたより。設定とは別のパネル（配信部屋のときだけ小窓にボタンが出る）
  const openMail = () => {
    if (mailWin) { mailWin.show(); mailWin.focus(); return; }
    if (unified) {
      mailWin = viewHost('mail', path.join(__dirname, 'mail.html'), path.join(__dirname, 'room-preload.js'));
    } else {
      const rb = roomWin.win.getBounds(), wa = screen.getDisplayMatching(rb).workArea, w = 360, h = 480;
      const mw = new BrowserWindow({
        x: Math.min(rb.x + rb.width + 8, wa.x + wa.width - w), y: Math.min(Math.max(rb.y + 40, wa.y), wa.y + wa.height - h),
        width: w, height: h, minWidth: 300, minHeight: 280, alwaysOnTop: true, backgroundColor: '#0d1526', title: 'おたより',
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'room-preload.js') },
      });
      mw.setAlwaysOnTop(true, 'floating');
      mailWin = windowHost(mw);
      mailWin.loadFile(path.join(__dirname, 'mail.html'));
    }
    mailWin.wc.on('did-finish-load', () => { if (mailWin && lastSnap) mailWin.wc.send('state', lastSnap); });
    mailWin.onClosed(() => { mailWin = null; sendState(); sendShellState(); });
    if (unified) selectTab('mail');
    sendState();
    sendShellState();
  };
  ipcMain.on('potalk:mail-open', e => {
    if (!roomWin || e.sender !== roomWin.wc) return;
    openMail();
  });
  ipcMain.on('potalk:room-pin', e => {
    if (!fromRoom(e)) return;
    if (unified) return; // 統合モードでは「最前面」はシェル側の概念がないため何もしない
    roomWin.win.setAlwaysOnTop(!roomWin.win.isAlwaysOnTop(), 'floating');
    roomWin.wc.send('pin', roomWin.win.isAlwaysOnTop());
  });
  // 統合モードの左タブからの操作
  ipcMain.on('shell:select', (e, tab) => {
    if (!unified || e.sender !== win.webContents) return;
    if (tab === 'chat') { openChat(); return; }
    if (tab === 'mail') { if (roomWin) openMail(); return; }
    if (tab === 'rset') { if (roomWin) openRset(); return; }
    selectTab(tab);
  });
  ipcMain.on('shell:mode', e => { if (unified && e.sender === win.webContents) requestModeChange('split'); });
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
    settingsWin.on('closed', () => { settingsWin = null; const pw = pageWC(); if (!pw.isDestroyed()) pw.send('potalk:profile-changed'); });
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
    pageWC().send('potalk:create', { name: v.name.trim().slice(0, 30), kind: v.kind === 'bc' ? 'bc' : 'chat' });
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
  const pwc = pageWC();
  pwc.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) pwc.loadFile(OFFLINE); });
  pwc.on('render-process-gone', () => pwc.loadURL(HOME));
  pwc.loadURL(HOME);
  const marker = path.join(app.getPath('userData'), 'settings-shown');
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); pwc.once('did-finish-load', openSettings); }
  pwc.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === ORIGIN) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  pwc.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });
  if (unified) {
    win.on('resize', () => { const v = views[currentTab]; if (v) layoutView(v); });
    selectTab('page');
  }
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
  uiMode = loadUiMode();
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length || createWindow());
});
app.on('window-all-closed', () => app.quit());
