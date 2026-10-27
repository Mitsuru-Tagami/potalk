// ページ(potalk.app の index.html)に「過去ログ共有」を足す差し込み。
// このアプリどうしの間だけで働く：入室した人に、先にいた人が（自分が受け取った）ひとことを渡す。
// 差し込み位置が見つからないときは、何もせず元のページをそのまま使う。
const HIST_CODE = `
// ---- [potalk-mac] 過去ログ共有 ----
const pmHistSend = id => {
  const rows = [...chatLogEl.querySelectorAll('.cl-row:not(.cl-sys):not(.cl-hist)')].slice(-30)
  const items = rows.map(r => ({
    e: r.querySelector('.cl-em')?.textContent || '',
    n: (r.querySelector('.cl-who')?.textContent || '').replace('（あなた）', '') || (profile && profile.name) || '',
    t: r.querySelector('.cl-text')?.textContent || '',
  })).filter(x => x.t)
  if (items.length) sendTo(pmHistAction, items, id)
}
let pmHistFor = null, pmHistAction = null
const pmHistRecv = (data, peerId) => {
  if (!call.joinedId || pmHistFor === call.joinedId || call.ignored.has(peerId) || !Array.isArray(data)) return
  pmHistFor = call.joinedId
  const frag = document.createDocumentFragment()
  const head = document.createElement('div'); head.className = 'cl-row cl-sys cl-hist'
  const hx = document.createElement('span'); hx.className = 'cl-text'; hx.textContent = 'ここから過去ログ（参加者から受け取ったもの・真偽は未確認）'
  head.append(hx); frag.append(head)
  data.slice(-30).forEach(x => {
    const t = capText(x && x.t, CHAT_MAX); if (!t) return
    const row = document.createElement('div'); row.className = 'cl-row cl-hist'
    const em = document.createElement('span'); em.className = 'cl-em'; em.textContent = capText(x.e, 8, '🙂')
    const who = document.createElement('span'); who.className = 'cl-who'; who.textContent = capText(x.n, 20, 'ゲスト')
    const tx = document.createElement('span'); tx.className = 'cl-text'; tx.textContent = t
    row.append(em, who, tx); frag.append(row)
  })
  if (frag.childElementCount > 1) { chatLogEl.prepend(frag); chatLogEl.hidden = false }
}
`;

const PATCHES = [
  { find: 'const CHAT_LOG_MAX = 30\n', replace: m => m + HIST_CODE },
  { find: "call.chatAction = call.room.makeAction('chat')", replace: m =>
      "pmHistAction = call.room.makeAction('hist'); pmHistAction.onMessage = (d, { peerId }) => pmHistRecv(d, peerId)\n  " + m },
  { find: 'sendProfile(id); sendMeta(id);', replace: m => m + ' pmHistSend(id);' },
  // 名刺と「無視」の確認は、アプリ側の小窓に出すので、ページ内ではモーダルにしない（開いたまま・見えない状態にする）
  { find: "try { $('cardDlg').showModal() } catch {}", replace: () => "try { $('cardDlg').show() } catch {}" },
  { find: "try { $('ignoreDlg').showModal() } catch { doIgnore(id) }", replace: () => "try { $('ignoreDlg').show() } catch { doIgnore(id) }" },
  // 共有するURLには、部屋の名前（&name=…）を付けない（部屋のIDだけで入れる）
  { find: "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id + (name ? '&name=' + encodeURIComponent(name) : '')", replace: () => "const roomUrl = (id, name) => location.origin + location.pathname + '#room=' + id" },
  // ロビーの各部屋に部屋IDを持たせる（アプリの検索・リンク指定で使う）
  { find: 'btn.onclick = () => askRoom(room, lobbyName(room, people))', replace: m => "btn.dataset.room = room; " + m },
  // リアクションが出た（自分が押した／届いた）ことをアプリに知らせる。ページ内の行が見えていなくても飛ばせるように
  { find: 'const flyReaction = (uid, idx) => {\n', replace: m => m +
      "  try { window.dispatchEvent(new CustomEvent('pm-react', { detail: JSON.stringify({ u: String(uid), i: idx, e: REACTIONS[idx], n: uid === 'self' ? '' : ((call.profiles.get(uid) || {}).name || '') }) })) } catch {}\n" },
];

function applyPatches(html) {
  let out = html;
  for (const p of PATCHES) {
    const first = out.indexOf(p.find);
    if (first < 0 || out.indexOf(p.find, first + 1) >= 0) return { html, applied: false, missing: p.find };
    out = out.slice(0, first) + p.replace(p.find) + out.slice(first + p.find.length);
  }
  return { html: out, applied: true };
}
module.exports = { applyPatches };
