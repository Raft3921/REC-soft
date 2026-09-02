#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22以降を先にインストールしてください。"
  read "reply?カーを押すと終了します: "
  exit 1
fi
[[ -d node_modules ]] || npm install
npm start
