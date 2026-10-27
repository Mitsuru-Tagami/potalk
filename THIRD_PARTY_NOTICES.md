# 第三者の表示

このリポジトリ（Potalker）は、ぽっと通話の公開リポジトリを参考にして作った、非公式のクライアントです。参考にした部分（画面の文言、機能の考え方、ページの構造を読み取るための識別子など）について、元のライセンスの表示を、ここに記載します。

## po-talk/po-talk.github.io

- リポジトリ: https://github.com/po-talk/po-talk.github.io
- ライセンス: MIT License

```
MIT License

Copyright (c) 2026 qramo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 注意

- 実行時に読み込む potalk.app のページ、およびその中で使われている部品（Trystero、nostr-tools、つくよみちゃんの素材など）は、このリポジトリには含まれていません。それぞれの作者と、ライセンスに従います。詳しくは、元のリポジトリの `THIRD_PARTY_NOTICES.md` と `vendor/LICENSES.md` を参照してください。
- Electron 版（`potalk-mac/`）は、実行に Electron（MIT License）を使います。依存は `npm install` で取得するため、このリポジトリには含まれていません。
