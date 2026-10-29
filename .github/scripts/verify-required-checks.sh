#!/usr/bin/env bash
# このコミット（GITHUB_SHA）が main の履歴にあり、main のルールセットの必須のチェックがどれも成功しているかを確かめる（deploy.yaml の verify-ci）。
# まだ終わっていないもの、check run がまだないものは、終わるまで待つ。Release の run は、main の CI が走っている間に始まるため（ADR 0010 の Q1）。
# main にないとき、失敗したものがあるとき、待つ上限を過ぎたときは、1 で終わる。
#
# 使い方: verify-required-checks.sh <ルールセットの JSON>（docs/runbooks/main-ruleset.json）
# 環境変数: GITHUB_REPOSITORY と GITHUB_SHA（Actions が入れる）、GH_TOKEN（contents: read と checks: read があればよい）、
#           CI_WAIT_SECONDS（待つ上限の秒数）、CI_POLL_SECONDS（確かめ直す間隔の秒数）
# テスト: tools/docs-check/test/verify-required-checks.test.ts（偽の gh を PATH の先頭に置いて動かす）
set -euo pipefail

ruleset=$1
wait_seconds=${CI_WAIT_SECONDS:?}
poll_seconds=${CI_POLL_SECONDS:?}

# main にないコミット（マージ前のブランチ、main から分かれたもの）は、main のルールセットを通っていないので出さない。
# このコミットが main の先頭か、それより前にあれば、main から見て identical か behind になる
on_main=$(gh api "repos/${GITHUB_REPOSITORY}/compare/main...${GITHUB_SHA}" --jq .status)
echo "main: ${on_main}"
if [ "$on_main" != identical ] && [ "$on_main" != behind ]; then
  echo "::error::${GITHUB_SHA} は main の履歴にない（${on_main}）。main にマージしたコミットだけを出す"
  exit 1
fi

# 必須のチェックの名前は、ルールセットのファイルから読む。workflow に書き写すと、ルールセットとずれても気づけない
checks=$(jq -r '.rules[] | select(.type == "required_status_checks")
  | .parameters.required_status_checks[] | "\(.context) \(.integration_id)"' "$ruleset")
if [ -z "$checks" ]; then
  echo "::error::${ruleset} に必須のチェックがない"
  exit 1
fi

while true; do
  failed=0
  pending=()
  while read -r name app_id; do
    # integration_id（15368 は GitHub Actions）を app_id に渡し、ルールセットと同じく GitHub Actions が付けたチェックだけを見る。
    # 動かし直すと同じ名前の check run が増えるので、いちばん新しい（ID が大きい）ものを見る。
    # 読み出しに失敗したとき（GitHub の API の 5xx など）は api_error として、次の周で確かめ直す。
    # 30 分の間に一度失敗しただけで止めると、Release の run を動かし直すことになる。gh のエラーは stderr に出る
    if ! result=$(gh api -X GET "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/check-runs" \
      -f check_name="$name" -F app_id="$app_id" -f filter=latest |
      jq -r '.check_runs | max_by(.id)
        | if . == null then "not_found" elif .status != "completed" then .status else .conclusion end'); then
      result=api_error
    fi
    echo "${name}: ${result}"
    case "$result" in
    success) ;;
    # まだ終わっていない（queued・in_progress など）か、CI の job がまだ作られていないか、読み出しに失敗した
    not_found | api_error | queued | in_progress | waiting | requested | pending) pending+=("${name} ${result}") ;;
    *)
      # 変数のすぐ後ろに全角の文字があると、そのバイトまで変数名に読まれることがあるので、{} で囲む
      echo "::error::${GITHUB_SHA} の ${name} が成功していない（${result}）。直して main にマージしてから出す"
      failed=1
      ;;
    esac
  done <<<"$checks"

  # 失敗したものは、待っても成功に変わらないので、ほかがまだ走っていても止める
  if [ "$failed" -eq 1 ]; then
    exit 1
  fi
  if [ "${#pending[@]}" -eq 0 ]; then
    exit 0
  fi
  if [ "$SECONDS" -ge "$wait_seconds" ]; then
    for entry in "${pending[@]}"; do
      read -r name result <<<"$entry"
      echo "::error::${GITHUB_SHA} の ${name} が ${wait_seconds} 秒待っても終わらない（${result}）。main の CI を見る"
    done
    exit 1
  fi
  echo "まだ終わっていないチェックがある。${poll_seconds} 秒後に確かめ直す"
  sleep "$poll_seconds"
done
