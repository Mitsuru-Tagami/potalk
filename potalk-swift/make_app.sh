#!/bin/bash
# 使い方: ./make_app.sh [debug|release|universal]   → build/ぽっと通話.app を作る（universal は Apple Silicon と Intel の両対応）
set -e
CFG="${1:-release}"
cd "$(dirname "$0")"
if [ "$CFG" = "universal" ]; then
  swift build -c release --arch arm64 --arch x86_64 2>&1 | tail -2
  BIN=".build/out/Products/Release/PotalkMac"
else
  swift build -c "$CFG" 2>&1 | tail -3
  BIN=".build/$CFG/PotalkMac"
fi
APP="build/ぽっと通話.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/PotalkMac"
[ -f ../potalk-mac/icon.icns ] && cp ../potalk-mac/icon.icns "$APP/Contents/Resources/icon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>ぽっと通話</string>
<key>CFBundleDisplayName</key><string>ぽっと通話</string>
<key>CFBundleIdentifier</key><string>app.potalk.mac</string>
<key>CFBundleExecutable</key><string>PotalkMac</string>
<key>CFBundleIconFile</key><string>icon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSMicrophoneUsageDescription</key><string>通話のためにマイクを使用します。</string>
<key>NSLocalNetworkUsageDescription</key><string>通話相手と直接つなぐために、ローカルネットワークを使用します。</string>
<key>LSApplicationCategoryType</key><string>public.app-category.social-networking</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP" 2>&1 | tail -1
echo "built: $APP"
