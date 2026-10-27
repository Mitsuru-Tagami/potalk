import SwiftUI
import AppKit

/// ページの入力欄と同期する TextField（ページ側で切り詰められた値もそのまま反映する）
struct SyncedField: View {
    @EnvironmentObject var engine: Engine
    let placeholder: String
    let remote: String
    let send: (String) -> Void
    @State private var text = ""
    var body: some View {
        TextField(placeholder, text: $text).textFieldStyle(.roundedBorder)
            .onAppear { text = remote }
            .onChange(of: text) { _, v in if v != remote { send(v) } }
            .onChange(of: remote) { _, v in if v != text { text = v } }
    }
}

struct CropItem: Identifiable { let id = UUID(); let image: NSImage }

struct CardEditView: View {
    @EnvironmentObject var engine: Engine
    @EnvironmentObject var model: AppModel
    @State private var crop: CropItem?
    @State private var bio = ""

    var s: CardEditState? { engine.cards.edit }

    var body: some View {
        if let s = s {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("📇 名刺（プロフィール）設定").font(.system(size: 17, weight: .bold))
                        Text("端末にのみ保存され、相手があなたのアイコン・名前を押した時だけ直接渡されます。").font(.caption).foregroundColor(.secondary)
                        avatar(s)
                        Divider()
                        bioSection(s)
                        Divider()
                        tips(s)
                        Divider()
                        sns(s)
                        Toggle("相手の名刺の画像を表示しない（絵文字だけにする）", isOn: Binding(get: { s.noImg }, set: { engine.cmd(["type": "ceNoImg", "on": $0]) }))
                        if !s.warn.isEmpty { Text(s.warn).font(.caption).foregroundColor(.orange) }
                    }.padding(18)
                }
                Divider()
                HStack {
                    Button("閉じる") { engine.cmd(["type": "ceClose"]) }.keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("保存する") { engine.cmd(["type": "ceSave"]) }.keyboardShortcut(.defaultAction)
                }.padding(12)
            }
            .frame(minWidth: 480, idealWidth: 500, minHeight: 560, idealHeight: 740)
            .sheet(item: $crop) { c in CropSheet(image: c.image) { data in
                crop = nil
                if let data { engine.cmd(["type": "ceAvatarFile", "b64": data.base64EncodedString(), "name": "avatar.jpg", "mime": "image/jpeg"]) }
            } }
        } else { Color.clear.frame(minWidth: 480, minHeight: 560) }
    }

    func avatar(_ s: CardEditState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("名刺アイコン（画像または絵文字）").font(.caption).foregroundColor(.secondary)
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if !s.img.isEmpty, let u = URL(string: s.img) { AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { Text(s.emoji) } }
                        else { Text(s.emoji).font(.system(size: 26)) }
                    }.frame(width: 48, height: 48).background(Color.primary.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 12))
                    if !s.sub.isEmpty { Text(s.sub).font(.system(size: 12)).frame(width: 20, height: 20).background(Circle().fill(Color(nsColor: .windowBackgroundColor))).offset(x: 3, y: 3) }
                }
                Button("📷 画像を選ぶ") { pick() }
                if s.clearShow { Button("画像を削除") { engine.cmd(["type": "ceAvatarClear"]) }.buttonStyle(.link) }
            }
            if !s.avatarMsg.isEmpty { Text(s.avatarMsg).font(.caption).foregroundColor(.orange) }
        }
    }
    func pick() {
        let p = NSOpenPanel(); p.allowedContentTypes = [.image]; p.allowsMultipleSelection = false
        if p.runModal() == .OK, let u = p.url, let img = NSImage(contentsOf: u) { crop = CropItem(image: img) }
    }

    func bioSection(_ s: CardEditState) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text("ひとこと（bio）").font(.caption).foregroundColor(.secondary); Spacer(); Text("\(s.bio.count)/60").font(.caption).foregroundColor(.secondary) }
            SyncedField(placeholder: "自己紹介やステータスなど（最大60文字）", remote: s.bio) { engine.cmd(["type": "ceField", "field": "bio", "value": String($0.prefix(60))]) }
        }
    }

    func tips(_ s: CardEditState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("お礼・チップ窓口（提示する1件を選択）").font(.caption).foregroundColor(.secondary)
            tipRadio("none", "提示しない（非表示）", nil, "", s)
            tipRadio("ofuse", "☕ OFUSE", "tipOfuse", s.tipOfuse, s, "URL または ユーザID")
            tipRadio("amazon", "📦 ほしい物リスト", "tipAmazon", s.tipAmazon, s, "URL または リストID")
            tipRadio("zap", "⚡ Nostr Zap", "tipZap", s.tipZap, s, "name@domain または npub")
            tipRadio("kofi", "☕ Ko-fi", "tipKofi", s.tipKofi, s, "URL または ユーザ名")
            tipRadio("bmac", "🥐 Buy Me Coffee", "tipBmac", s.tipBmac, s, "URL または ユーザ名")
            Text("※ Amazonほしい物リストは配送先の本名や住所バレにご注意ください。").font(.caption2).foregroundColor(.secondary)
        }
    }
    @ViewBuilder func tipRadio(_ v: String, _ name: String, _ field: String?, _ remote: String, _ s: CardEditState, _ ph: String = "") -> some View {
        HStack {
            Button { engine.cmd(["type": "ceTipOpt", "v": v]) } label: { Image(systemName: s.tipOpt == v ? "largecircle.fill.circle" : "circle") }.buttonStyle(.plain)
            Text(name).frame(width: field == nil ? nil : 130, alignment: .leading)
            if let field { SyncedField(placeholder: ph, remote: remote) { engine.cmd(["type": "ceField", "field": field, "value": $0]) } }
            Spacer(minLength: 0)
        }
    }

    func sns(_ s: CardEditState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SNS ID（オプトイン本人確認対応）").font(.caption).foregroundColor(.secondary)
            snsRow("𝕏 (Twitter)", "snsX", s.snsX, "URL または @ID", "x", s.verX)
            snsRow("🐙 GitHub", "snsGithub", s.snsGithub, "URL または ユーザ名", "github", s.verGithub)
            snsRow("📝 note", "snsNote", s.snsNote, "URL または クリエイター名", nil, nil)
            snsRow("📸 Instagram", "snsInstagram", s.snsInstagram, "URL または ユーザ名", nil, nil)
            snsRow("▶️ YouTube", "snsYoutube", s.snsYoutube, "URL または @ハンドル", nil, nil)
            snsRow("🟣 Nostr", "snsNostr", s.snsNostr, "URL または npub1...", "nostr", s.verNostr)
            Text("※ 各サービスのプロフィールURLを貼ると自動でIDに切り詰めます。「認証」で本人確認すると、相手が「✅ を確かめる」を押したときに確認できます。").font(.caption2).foregroundColor(.secondary)
        }
    }
    @ViewBuilder func snsRow(_ name: String, _ field: String, _ remote: String, _ ph: String, _ key: String?, _ ver: VerState?) -> some View {
        HStack {
            Text(name).frame(width: 110, alignment: .leading)
            SyncedField(placeholder: ph, remote: remote) { engine.cmd(["type": "ceField", "field": field, "value": $0]) }
            if let key, let ver {
                if ver.verified {
                    Button("✅") { unverify(key) }.buttonStyle(.plain).help("認証済み（押すと解除）")
                } else if ver.btnShow {
                    Button(ver.btnLabel.isEmpty ? "認証" : ver.btnLabel) { engine.cmd(["type": "ceVerify", "k": key]) }.disabled(ver.btnDisabled)
                }
            } else { Text("自己申告").font(.caption2).foregroundColor(.secondary) }
        }
    }
    func unverify(_ key: String) {
        let a = NSAlert(); a.messageText = "認証を解除しますか？"; a.informativeText = "解除すると、相手の画面で ✅ が付かなくなります。"
        a.addButton(withTitle: "解除する"); a.addButton(withTitle: "キャンセル")
        if a.runModal() == .alertFirstButtonReturn { engine.cmd(["type": "ceUnverify", "k": key]) }
    }
}

// MARK: 画像の切り抜き（ドラッグで位置、スライダーで大きさ）
struct CropSheet: View {
    let image: NSImage
    let done: (Data?) -> Void
    @State private var zoom: CGFloat = 1
    @State private var offset = CGSize.zero
    @State private var dragStart = CGSize.zero
    let V: CGFloat = 300

    var base: CGFloat { max(V / image.size.width, V / image.size.height) }
    var scale: CGFloat { base * zoom }
    func clamp(_ o: CGSize) -> CGSize {
        let w = image.size.width * scale, h = image.size.height * scale
        return CGSize(width: min(0, max(V - w, o.width)), height: min(0, max(V - h, o.height)))
    }
    var origin: CGSize {   // 左上の位置
        let w = image.size.width * scale, h = image.size.height * scale
        return clamp(CGSize(width: (V - w) / 2 + offset.width, height: (V - h) / 2 + offset.height))
    }
    var body: some View {
        VStack(spacing: 12) {
            Text("画像の位置を決める").font(.system(size: 15, weight: .bold))
            Text("ドラッグで位置、つまみで大きさを調整します。枠の中が名刺の画像になります。").font(.caption).foregroundColor(.secondary)
            ZStack(alignment: .topLeading) {
                Color.white
                Image(nsImage: image).resizable().frame(width: image.size.width * scale, height: image.size.height * scale).offset(x: origin.width, y: origin.height)
            }
            .frame(width: V, height: V).clipped().overlay(Rectangle().stroke(Color.primary.opacity(0.3)))
            .gesture(DragGesture().onChanged { v in offset = CGSize(width: dragStart.width + v.translation.width, height: dragStart.height + v.translation.height) }
                .onEnded { _ in dragStart = offset })
            HStack { Text("🔍"); Slider(value: $zoom, in: 1...4) }.frame(width: V)
            HStack { Button("やめる") { done(nil) }.keyboardShortcut(.cancelAction); Spacer(); Button("決定") { done(render()) }.keyboardShortcut(.defaultAction) }.frame(width: V)
        }.padding(20)
    }
    /// 枠の中を 512×512 の JPEG にする
    func render() -> Data? {
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let pxPerPt = CGFloat(cg.width) / image.size.width
        let o = origin
        let rect = CGRect(x: (-o.width / scale) * pxPerPt, y: (-o.height / scale) * pxPerPt, width: (V / scale) * pxPerPt, height: (V / scale) * pxPerPt).integral
        guard let cropped = cg.cropping(to: rect.intersection(CGRect(x: 0, y: 0, width: cg.width, height: cg.height))) else { return nil }
        let out = 512
        guard let ctx = CGContext(data: nil, width: out, height: out, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(NSColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: out, height: out))
        ctx.interpolationQuality = .high; ctx.draw(cropped, in: CGRect(x: 0, y: 0, width: out, height: out))
        guard let outImg = ctx.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: outImg).representation(using: .jpeg, properties: [.compressionFactor: 0.85])
    }
}

// MARK: 本人確認
struct CardAuthView: View {
    @EnvironmentObject var engine: Engine
    @State private var copiedCode = false
    @State private var copiedPost = false
    var body: some View {
        if let a = engine.cards.auth {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(a.title).font(.system(size: 17, weight: .bold))
                    Text(a.account).font(.system(size: 13, weight: .semibold))
                    Text(a.desc).font(.system(size: 13))
                    if a.codeShow {
                        Text("あなたの名刺の鍵").font(.caption).foregroundColor(.secondary)
                        HStack {
                            Text(a.code).font(.system(size: 12, design: .monospaced)).textSelection(.enabled).lineLimit(3)
                            Spacer()
                            Button(copiedCode ? "✅ コピー済" : "📋 鍵の行をコピー") { copy(a.code); copiedCode = true; reset { copiedCode = false } }
                        }.padding(10).card(10)
                    }
                    if a.postShow {
                        Text(a.post).font(.system(size: 13)).padding(10).frame(maxWidth: .infinity, alignment: .leading).card(10).textSelection(.enabled)
                        HStack {
                            Button("𝕏 でポストする") { if let u = URL(string: a.tweet) { NSWorkspace.shared.open(u) } }
                            Button(copiedPost ? "✅ コピー済" : "📋 投稿文をコピー") { copy(a.post); copiedPost = true; reset { copiedPost = false } }
                        }
                    }
                    if a.inputShow {
                        Text("投稿したポストのリンク（共有URL）").font(.caption).foregroundColor(.secondary)
                        SyncedField(placeholder: "https://x.com/ユーザー名/status/...", remote: a.input) { engine.cmd(["type": "caInput", "value": $0]) }
                    }
                    if !a.msg.isEmpty { Text(a.msg).font(.system(size: 13)).foregroundColor(a.msgBad ? .red : .green) }
                    Text(a.note).font(.caption).foregroundColor(.secondary)
                    HStack {
                        Button("やめる") { engine.cmd(["type": "caCancel"]) }.keyboardShortcut(.cancelAction)
                        Spacer()
                        Button(a.verifyLabel.isEmpty ? "確認する" : a.verifyLabel) { engine.cmd(["type": "caVerify"]) }.keyboardShortcut(.defaultAction).disabled(a.verifyDisabled)
                    }
                }.padding(18)
            }.frame(minWidth: 440, idealWidth: 460, minHeight: 420, idealHeight: 520)
        } else { Color.clear.frame(minWidth: 440, minHeight: 420) }
    }
    func copy(_ s: String) { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string) }
    func reset(_ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: f) }
}
