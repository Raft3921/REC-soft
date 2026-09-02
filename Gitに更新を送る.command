#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v git >/dev/null 2>&1 || [[ ! -d .git ]]; then
  echo "Gitリポジトリが見つかりません。"; read "reply?カーを押すと終了: "; exit 1
fi
version="$(node scripts/next-version.js)" || exit 1
npm install --package-lock-only >/dev/null || exit 1
git add -A || exit 1
if git diff --cached --quiet; then echo "送信する変更はありません。"; read "reply?カーを押すと終了: "; exit 0; fi
message="${1:-REC soft v${version}}"
git commit -m "$message" && git tag "v${version}" && git push origin "$(git branch --show-current)" && git push origin "v${version}"
status=$?
(( status == 0 )) && echo "v${version} をGitHubへ送信しました。Windows EXEの作成が始まります。" || echo "送信に失敗しました。GitHub認証とネットワークを確認してください。"
read "reply?カーを押すと終了します: "
exit $status
