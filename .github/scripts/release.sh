#!/usr/bin/env bash
# deploy.yaml の版の判定と、デプロイのあとのタグ・Release・CHANGELOG の PR（ADR 0012）。
# 続けるか止めるかの判定と文字列づくりは tools/release/src/steps.ts（テストした純粋関数）に任せ、ここは gh で読み書きするだけにする。
# リポジトリのルートで、ブランチの上の run でだけ動かす。
#
#   release.sh plan     verify-ci（承認の前）。次の版と文面を決め、続けられない状態なら止める。
#                       run のまとめ（$GITHUB_STEP_SUMMARY）に書き、outputs（base-tag・version・notes-base64）で後ろの job に渡す
#                       env: BUMP、GH_TOKEN（pull-requests: read）
#   release.sh guard    deploy の最初。最新の v* タグがまだ基準のタグか、前の CHANGELOG の PR が開いていないかを確かめ直す
#                       env: BASE_TAG、GH_TOKEN（pull-requests: read）
#   release.sh publish  release。CHANGELOG の PR を作ってから、github.sha に Release とタグを作る。どの手順も、すでにあれば飛ばす
#                       env: BASE_TAG、VERSION、NOTES_BASE64、GH_TOKEN（App の token）
set -euo pipefail

: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}"

steps() {
  node tools/release/src/steps.ts "$@"
}

# 開いている PR の head のブランチを、steps.ts の --open-branch の引数にして open_branch_args に入れる。
# fork からの PR は数えない。誰でも changelog/ で始まるブランチの PR を開けるので、数えると dispatch を止められてしまう。
# gh が失敗したら止める（読めなかったのを「開いた PR がない」と取り違えない）
open_branch_args=()
read_open_branches() {
  local branches branch
  if ! branches=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --limit 1000 --json headRefName,isCrossRepository \
    --jq '.[] | select(.isCrossRepository | not) | .headRefName'); then
    echo "::error::開いている PR を読めなかった"
    exit 1
  fi
  while IFS= read -r branch; do
    if [[ -n $branch ]]; then
      open_branch_args+=(--open-branch "$branch")
    fi
  done <<<"$branches"
}

plan() {
  : "${BUMP:?}" "${GITHUB_OUTPUT:?}" "${GITHUB_STEP_SUMMARY:?}"
  local json status=0
  # 上げるものがない（1）ときも JSON は出るので、まとめに理由を書いてから止める。2 は引数の誤り
  json=$(node tools/release/src/cli.ts --bump "$BUMP" --to "$GITHUB_SHA") || status=$?
  if ((status > 1)) || [[ -z $json ]]; then
    echo "::error::次の版を決められなかった（${status}）"
    exit 1
  fi

  local base_tag next reason notes
  base_tag=$(jq -r '.baseTag // ""' <<<"$json")
  next=$(jq -r '.next // ""' <<<"$json")
  reason=$(jq -r '.reason' <<<"$json")
  notes=$(jq -r '.notes // ""' <<<"$json")

  {
    echo '## 次の版'
    echo
    echo "- bump: \`${BUMP}\`"
    echo "- 基準のタグ: \`${base_tag:-なし}\`"
    echo "- 次の版: \`${next:+v}${next:-なし}\`"
    echo "- 理由: ${reason}"
    if [[ -n $notes ]]; then
      echo
      echo '<details open><summary>リリースノート</summary>'
      echo
      echo "$notes"
      echo
      echo '</details>'
    fi
  } >>"$GITHUB_STEP_SUMMARY"

  if [[ -z $next ]]; then
    echo "::error::${reason}"
    exit 1
  fi

  read_open_branches
  steps check-plan --base-tag "$base_tag" --sha "$GITHUB_SHA" ${open_branch_args[@]+"${open_branch_args[@]}"}

  # 文面は commit の題名を含む。改行や区切りの文字で outputs を書き換えられないよう、base64 の1行にして渡す
  {
    echo "base-tag=${base_tag}"
    echo "version=${next}"
    echo "notes-base64=$(printf '%s\n' "$notes" | base64 | tr -d '\n')"
  } >>"$GITHUB_OUTPUT"
}

guard() {
  : "${BASE_TAG:?}"
  read_open_branches
  steps check-deploy --base-tag "$BASE_TAG" ${open_branch_args[@]+"${open_branch_args[@]}"}
}

work=''
repo_api="repos/${GITHUB_REPOSITORY}"
branch=''

# ブランチの上のファイルを steps.ts のサブコマンドで書き換え、変わったときだけ contents API でコミットする。
# App の token で API から作ったコミットには、GitHub が署名を付ける
update_file() {
  local path=$1
  shift
  local blob
  blob=$(gh api "${repo_api}/contents/${path}?ref=${branch}" --jq '.sha')
  gh api "${repo_api}/contents/${path}?ref=${branch}" -H 'Accept: application/vnd.github.raw+json' >"${work}/current"
  steps "$@" <"${work}/current" >"${work}/updated"
  if cmp -s "${work}/current" "${work}/updated"; then
    echo "${path} はすでに v${VERSION} に合っている"
    return
  fi
  # 本文は引数ではなくファイルで渡す。CHANGELOG が育つと、引数1つの長さの上限（128KB）を超える
  base64 <"${work}/updated" | tr -d '\n' >"${work}/content"
  jq -n --arg message "chore: ${path} を v${VERSION} に合わせる" --arg branch "$branch" --arg sha "$blob" \
    --rawfile content "${work}/content" '{message: $message, branch: $branch, sha: $sha, content: $content}' \
    >"${work}/request.json"
  gh api -X PUT "${repo_api}/contents/${path}" --input "${work}/request.json" >/dev/null
}

publish() {
  : "${BASE_TAG:?}" "${VERSION:?}" "${NOTES_BASE64:?}"
  local decision
  decision=$(steps check-release --base-tag "$BASE_TAG" --version "$VERSION" --sha "$GITHUB_SHA")
  if [[ $decision == skip ]]; then
    return
  fi
  if [[ $decision != continue ]]; then
    echo "::error::check-release の答えが分からない: ${decision}"
    exit 1
  fi

  local tag="v${VERSION}" pr title body
  work=$(mktemp -d)
  printf '%s' "$NOTES_BASE64" | base64 -d >"${work}/notes.md"
  pr=$(steps pr --version "$VERSION")
  branch=$(jq -r '.branch' <<<"$pr")
  title=$(jq -r '.title' <<<"$pr")
  body=$(jq -r '.body' <<<"$pr")

  # 1. CHANGELOG の PR のブランチを、main の先頭から切る
  local existing main_sha
  existing=$(gh api "${repo_api}/git/matching-refs/heads/${branch}" --jq "map(select(.ref == \"refs/heads/${branch}\")) | length")
  if ((existing == 0)); then
    main_sha=$(gh api "${repo_api}/git/ref/heads/main" --jq '.object.sha')
    gh api -X POST "${repo_api}/git/refs" -f ref="refs/heads/${branch}" -f sha="$main_sha" >/dev/null
  else
    echo "${branch} はすでにある"
  fi

  # 2. CHANGELOG.md とルートの package.json の version を書き換える
  update_file CHANGELOG.md changelog --notes-file "${work}/notes.md"
  update_file package.json package-version --version "$VERSION"

  # 3. PR を開く。閉じたものも含めて、このリポジトリのこのブランチの PR がすでにあれば作らない。
  #    fork の同じ名前のブランチの PR は数えない（数えると、CHANGELOG の PR を作らずに飛ばしてしまう）
  local prs
  prs=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$branch" --state all --json isCrossRepository \
    --jq 'map(select(.isCrossRepository | not)) | length')
  if ((prs == 0)); then
    gh pr create --repo "$GITHUB_REPOSITORY" --base main --head "$branch" --title "$title" --body "$body"
  else
    echo "${branch} の PR はすでにある"
  fi

  # 4. Release を作る。タグも Release API に作らせ、デプロイしたコミット（github.sha）に打つ
  if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
    echo "${tag} の Release はすでにある"
  else
    steps release-body --notes-file "${work}/notes.md" >"${work}/body.md"
    gh release create "$tag" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --title "$tag" --notes-file "${work}/body.md"
  fi
}

case "${1:-}" in
  plan) plan ;;
  guard) guard ;;
  publish) publish ;;
  *)
    echo "使い方: $0 plan|guard|publish" >&2
    exit 2
    ;;
esac
