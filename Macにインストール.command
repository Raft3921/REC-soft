#!/bin/zsh
cd "$(dirname "$0")" || exit 1
set -e
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22以降を先にインストールしてください。"
  read "reply?カーを押すと終了します: "
  exit 1
fi
[[ -d node_modules ]] || npm install
identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -1)"
if [[ -n "$identity" ]]; then
  CSC_NAME="$identity" npx electron-builder --mac dir --"$(uname -m | sed 's/aarch64/arm64/')" --publish never
else
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --"$(uname -m | sed 's/aarch64/arm64/')" --publish never
fi
app_path="dist/mac-arm64/REC soft.app"
[[ "$(uname -m)" == "x86_64" ]] && app_path="dist/mac/REC soft.app"
if [[ -e "/Applications/REC soft.app" ]]; then
  old_app="/Users/$USER/.Trash/REC soft old $(date '+%Y-%m-%d %H-%M-%S').app"
  mv "/Applications/REC soft.app" "$old_app"
fi
ditto "$app_path" "/Applications/REC soft.app"
xattr -dr com.apple.quarantine "/Applications/REC soft.app"
codesign --verify --deep --strict "/Applications/REC soft.app"
open "/Applications/REC soft.app"
echo "REC softをアプリケーションにインストールしました。"
read "reply?カーを押すと終了します: "
