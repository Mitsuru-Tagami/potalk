# ぽっと通話 Mac アプリ

[potalk.app](https://potalk.app/)（ぽっと通話）の Mac 用クライアントです。通話の仕組み（Nostr での相手探しと WebRTC）は、サイトのページをそのまま使い、画面まわりを Mac 向けに作り直しています。

| フォルダ | 中身 |
|---|---|
| `potalk-swift/` | Swift 製（AppKit / SwiftUI）。通話の仕組みは、画面に出ない WKWebView で動かす。**こちらが本命。** |
| `potalk-mac/` | Electron 製（先に作った版）。 |

## ダウンロード（Swift 版）

[Releases](https://github.com/riryo3/potalk/releases) から `PotalkMac-*.zip` をダウンロードして、展開した「ぽっと通話.app」を「アプリケーション」に入れてください（Apple Silicon・Intel 両対応、macOS 14 以降）。

- Apple の公証を受けていないため、ブラウザでダウンロードした直後は「開けません」と出ることがあります。そのときは、アプリを**右クリック →「開く」**、または次のコマンドを実行してください。

  ```bash
  xattr -dr com.apple.quarantine /Applications/ぽっと通話.app
  ```

## Swift 版のビルド

```bash
cd potalk-swift
./make_app.sh release     # build/ぽっと通話.app ができる（簡易署名・この Mac の CPU 用）
./make_app.sh universal   # Apple Silicon と Intel の両対応
```

- macOS 14 以降、Xcode（Swift 6）が必要です。
- 初回の起動で、マイク・ローカルネットワーク・通知の許可を求められます。
- ページへの小さな差し込み（過去ログ共有、リアクションの効果など）は `Sources/PotalkMac/PagePatcher.swift` にあります。差し込み位置が見つからないときは、元のページをそのまま使います。

## Electron 版

```bash
cd potalk-mac
npm install
npm start
```

## 注意

- 実験用のクライアントです。通話の相手探しや中継（TURN）は、potalk.app と同じ仕組みを使っています。
- サイト本体（potalk.app）の作者は別の方です。このリポジトリには、サイトのソースは含めていません。
