# Potalker（ぽっと通話 非公式 Mac クライアント）

> **これは非公式のクライアントです。** [ぽっと通話（potalk.app）](https://potalk.app/) の作者とは関係がありません。通話の仕組み（Nostr での相手探しと WebRTC）は、サイトのページをそのまま利用し、画面まわりだけを Mac 向けに作り直しています。ご利用は自己責任でお願いします。

| フォルダ | 中身 |
|---|---|
| `potalk-swift/` | Swift 製（AppKit / SwiftUI）の **Potalker**。通話の仕組みは、画面に出ない WKWebView で動かす。**こちらが本命。** |
| `potalk-mac/` | Electron 製（先に作った試作版）。 |

## ダウンロード（Swift 版）

[Releases](https://github.com/riryo3/potalk/releases) から `Potalker-*.zip` をダウンロードして、展開した「Potalker.app」を「アプリケーション」に入れてください（Apple Silicon・Intel 両対応、macOS 14 以降）。

- Apple の公証を受けていないため、ブラウザでダウンロードした直後は「開けません」と出ることがあります。そのときは、アプリを**右クリック →「開く」**、または次のコマンドを実行してください。

  ```bash
  xattr -dr com.apple.quarantine /Applications/Potalker.app
  ```

- 初回の起動で、マイク・ローカルネットワーク・通知の許可を求められます。

## Swift 版のビルド

```bash
cd potalk-swift
./make_app.sh release     # build/Potalker.app ができる（簡易署名・この Mac の CPU 用）
./make_app.sh universal   # Apple Silicon と Intel の両対応
```

- macOS 14 以降、Xcode（Swift 6）が必要です。
- 署名用の証明書がある場合は、`CODESIGN_ID="証明書の名前" ./make_app.sh release` のように指定できます。署名が変わらなければ、キーチェーンの「常に許可」が、ビルドし直しても効き続けます（既定は簡易署名で、ビルドのたびに許可の確認が出ることがあります）。
- ページへの小さな差し込み（過去ログ共有、リアクションの効果など）は `Sources/PotalkMac/PagePatcher.swift` にあります。差し込み位置が見つからないときは、元のページをそのまま使います。

## Windows 版（試験中）

Electron 版（`potalk-mac/`）を、Windows 向けにもビルドできるようにしました。GitHub Actions（`.github/workflows/build-windows.yml`）が、インストーラー（.exe）と zip を作ります。

- **まだ、Windows の実機での動作確認は、できていません。** 起動、入室、マイクの動作は、ご自身で確かめてから使ってください。
- 署名していないため、SmartScreen の警告が出ます（「詳細情報」→「実行」）。
- ローカルで作る場合: `cd potalk-mac && npm ci && npm run dist:win`

## Electron 版

```bash
cd potalk-mac
npm install
npm start
```

### ウィンドウモード（バラバラ／統合）

Electron 版には、画面の出し方が2つあります。切り替えはアプリを再起動して適用され、設定は `userData/ui-mode.json` に保存されます。

- **バラバラ**（既定）：従来どおり、ロビー・部屋・ひとこと等を別々のウィンドウで開く出し方です。
- **統合**：1つのウィンドウに集約する出し方です。左端のレール（アイコンだけの細い帯、名称はツールチップで表示）で、ロビー／部屋／ひとこと（未読バッジつき）／おたより／部屋設定／部屋を作る、などを切り替えます。
  - レールの色はページのテーマに追随します（ダーク固定への切り替えも可）。レールを左端に隠して、カーソルを寄せたときだけ出すドロワー表示もできます。
  - ロビー表示のまま左端にカーソルを寄せると、部屋一覧がのぞきます（ホバー式ピーク）。
  - 部屋一覧を詰めて表示するコンパクト表示があります。
  - ウィンドウの高さは未入室と入室中で別々に覚え、入室すると縦に伸び、退出すると戻ります。
  - 部屋パネルの操作ボタン（ひとこと／ミュート／URL共有／退出など）はアイコンだけにして、リアクションと1行に並べています。ひとことの新着はバッジで知らせます。
  - アクセス測定についての注記は、ロビーではなく設定（プロフィール欄）の中に表示します。

統合モードの動作確認は、主に Linux（Linux Mint）上の Electron 版で進めています。

## 参考にしたもの

このクライアントは、ぽっと通話の公開リポジトリ **[po-talk/po-talk.github.io](https://github.com/po-talk/po-talk.github.io)** を参考にして作りました。ページの構造や、通話の仕組み（部屋の探索、データのやり取り）を、このリポジトリのソースで調べ、画面まわりを Mac 向けに作り直しています。実行時には、公開されている potalk.app のページをそのまま読み込んで使います。サイトの作者の方々に感謝します。

## 注意

- 実験用の非公式クライアントです。通話の相手探しや中継（TURN）は、potalk.app と同じ仕組みを使っています。
- サイト本体（potalk.app）の作者は別の方です。このリポジトリには、サイトのソースは含めていません。
- 「ぽっと通話」「potalk」の名前とサイトは、それぞれの作者のものです。

## ライセンス

このリポジトリのコードは [MIT License](LICENSE) です（Copyright (c) 2026 riryo3）。参考にしたリポジトリのライセンスの表示は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。
