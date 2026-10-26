#!/usr/bin/env bash
# このコミット（GITHUB_SHA）で、main のルールセットの必須のチェックがどれも成功しているかを確かめる（deploy.yaml の verify-ci）。
# 失敗したもの、まだ終わっていないもの、check run がないものが1つでもあれば、1 で終わる。
#
# 使い方: verify-required-checks.sh <ルールセットの JSON>（docs/runbooks/main-ruleset.json）
# 環境変数: GITHUB_REPOSITORY と GITHUB_SHA（Actions が入れる）、GH_TOKEN（checks: read があればよい）
# テスト: tools/docs-check/test/verify-required-checks.test.ts（偽の gh を PATH の先頭に置いて動かす）
set -euo pipefail

ruleset=$1

# 必須のチェックの名前は、ルールセットのファイルから読む。workflow に書き写すと、ルールセットとずれても気づけない
checks=$(jq -r '.rules[] | select(.type == "required_status_checks")
  | .parameters.required_status_checks[] | "\(.context) \(.integration_id)"' "$ruleset")
if [ -z "$checks" ]; then
  echo "::error::${ruleset} に必須のチェックがない"
  exit 1
fi

failed=0
while read -r name app_id; do
  # integration_id（15368 は GitHub Actions）を app_id に渡し、ルールセットと同じく GitHub Actions が付けたチェックだけを見る。
  # 動かし直すと同じ名前の check run が増えるので、いちばん新しい（ID が大きい）ものを見る
  result=$(gh api -X GET "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/check-runs" \
    -f check_name="$name" -F app_id="$app_id" -f filter=latest |
    jq -r '.check_runs | max_by(.id)
      | if . == null then "not_found" elif .status != "completed" then .status else .conclusion end')
  echo "${name}: ${result}"
  if [ "$result" != success ]; then
    # 変数のすぐ後ろに全角の文字があると、そのバイトまで変数名に読まれることがあるので、{} で囲む
    echo "::error::${GITHUB_SHA} の ${name} が成功していない（${result}）。main の CI が終わってから動かす"
    failed=1
  fi
done <<<"$checks"

exit "$failed"
