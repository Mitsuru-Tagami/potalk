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

## Windows 版

[Releases](https://github.com/riryo3/potalk/releases) から `Potalker-win-x64.zip` をダウンロードして展開し、`Potalker.exe` を実行してください（Windows 10 / 11、64bit。.NET の別途インストールは不要です）。

- 署名していないため、SmartScreen の警告が出ることがあります（「詳細情報」→「実行」）。
- 通話の描画に Microsoft Edge WebView2 ランタイムを使います（Windows 11 には最初から入っています。入っていない場合は起動時にエラーが出ます）。
- 初回の通話で、マイクの許可を求められることがあります。
- 設定とウィンドウの位置は `%APPDATA%\Potalker\` に保存されます。
- 未対応: Swift 版のような、ウィンドウどうしの画面端への吸着。
- 本人確認（X・GitHub・Nostr）は、まだ実機で試していません。

### Windows 版のビルド

```bash
cd potalk-win
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o out
```

- .NET 8 SDK が必要です。GitHub Actions（`.github/workflows/build-windows-native.yml`）でも作れます。`win-v*` のタグを付けて push すると、Releases に zip が載ります。
- ページへの小さな差し込みは `PagePatcher.cs` にあります（Swift 版と同じ内容）。

## Electron 版（Windows・試作）

Electron 版（`potalk-mac/`）も、Windows 向けにビルドできます。GitHub Actions（`.github/workflows/build-windows.yml`）が、インストーラー（.exe）と zip を作ります。新しい Windows 版（`potalk-win/`）のほうが小さく軽いので、こちらは試作として残しています。

- ローカルで作る場合: `cd potalk-mac && npm ci && npm run dist:win`

## Electron 版

```bash
cd potalk-mac
npm install
npm start
```

## 参考にしたもの

このクライアントは、ぽっと通話の公開リポジトリ **[po-talk/po-talk.github.io](https://github.com/po-talk/po-talk.github.io)** を参考にして作りました。ページの構造や、通話の仕組み（部屋の探索、データのやり取り）を、このリポジトリのソースで調べ、画面まわりを Mac 向けに作り直しています。実行時には、公開されている potalk.app のページをそのまま読み込んで使います。サイトの作者の方々に感謝します。

## 注意

- 実験用の非公式クライアントです。通話の相手探しや中継（TURN）は、potalk.app と同じ仕組みを使っています。
- サイト本体（potalk.app）の作者は別の方です。このリポジトリには、サイトのソースは含めていません。
- 「ぽっと通話」「potalk」の名前とサイトは、それぞれの作者のものです。

## ライセンス

このリポジトリのコードは [MIT License](LICENSE) です（Copyright (c) 2026 riryo3）。参考にしたリポジトリのライセンスの表示は、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。
