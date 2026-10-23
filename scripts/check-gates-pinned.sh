#!/usr/bin/env bash
# check:gates 的包裝:釘住 SOURCE 標頭寫的模板 commit,再用那份 sync-gates.sh --check。
# 這支是本 repo 自己的,不是模板擁有的檔。不要加 SOURCE 標頭,也不要改任何帶標頭的檔。
#
# TEMPLATE_DIR 與 TEMPLATE_REPO 不是同一個變數:
#   TEMPLATE_DIR  使用者明設(非空)就維持舊行為,直接拿那個目錄的 sync-gates.sh。
#                 這條路不驗證釘版本,所以必須印「TEMPLATE_DIR 明設,未驗證釘版本」。
#   TEMPLATE_REPO 模板 git repo,給執行期 git archive 用。預設 /data/python/dev-loop-mcp。
#                 取不到 repo、取不到 commit、archive 解不出 sync-gates.sh,一律紅,
#                 不准退回活的 HEAD。
#
# 用法: check-gates-pinned.sh [consumer-root]
#   不給 consumer-root 時用 git rev-parse --show-toplevel(npm run check:gates 走這條)。
set -euo pipefail

if [ $# -gt 1 ]; then
  printf '%s\n' "✗ 用法: check-gates-pinned.sh [consumer-root]"
  exit 1
fi

if [ $# -eq 1 ]; then
  root=${1%/}
else
  root=$(git rev-parse --show-toplevel)
fi

# 明設優先。空字串與未設一樣走釘版本(對齊舊的 ${TEMPLATE_DIR:-default})。
if [ -n "${TEMPLATE_DIR:-}" ]; then
  printf '%s\n' "TEMPLATE_DIR 明設,未驗證釘版本"
  "$TEMPLATE_DIR/scripts/sync-gates.sh" "$root" scripts --check
  exit $?
fi

repo="${TEMPLATE_REPO:-/data/python/dev-loop-mcp}"

# 目錄不存在要印我們自己的句子。不准改去預設路徑、也不准改跑活 HEAD。
if [ ! -d "$repo" ]; then
  printf '%s\n' "✗ 模板 repo 不存在: ${repo}"
  exit 1
fi
if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
  printf '%s\n' "✗ 模板 repo 不是 git repo: ${repo}"
  exit 1
fi

pairs=""
tmp=""
archive_err=""
cleanup() {
  if [ -n "${tmp:-}" ]; then
    rm -rf "$tmp"
  fi
  if [ -n "${pairs:-}" ]; then
    rm -f "$pairs"
  fi
  if [ -n "${archive_err:-}" ]; then
    rm -f "$archive_err"
  fi
}
trap cleanup EXIT

pairs=$(mktemp)
archive_err=$(mktemp)

# 數標頭:第一行、head -1,grep 加 -a。不准 grep -l 掃全檔(正文裡的同一串字不是標頭)。
if [ -d "$root/scripts" ]; then
  find "$root/scripts" -type f -print0 | sort -z | while IFS= read -r -d '' f; do
    first=$(head -n 1 -- "$f" || true)
    if printf '%s\n' "$first" | grep -aEq '^(//|#) SOURCE: template v'; then
      parsed=$(printf '%s\n' "$first" | grep -aEo 'template v[^[:space:]]+ \([0-9a-fA-F]+\)' || true)
      parsed=${parsed%%$'\n'*}
      ver=$(printf '%s\n' "$parsed" | sed -n 's/^template \(v[^ ]*\) (.*/\1/p' || true)
      sha=$(printf '%s\n' "$parsed" | sed -n 's/^template v[^ ]* (\([0-9a-fA-F]*\)).*/\1/p' || true)
      rel=${f#"$root"/}
      if [ -n "$ver" ] && [ -n "$sha" ]; then
        printf '%s\t%s\t%s\n' "$rel" "$ver" "$sha"
      else
        printf '%s\tUNPARSED\tUNPARSED\n' "$rel"
      fi
    fi
  done > "$pairs"
fi

n_combos=$(awk -F '\t' 'NF { print $2 "\t" $3 }' "$pairs" | sort -u | wc -l | tr -d ' ')
# 零組或多於一組都紅,列出全部檔名與值。不准挑多數那組繼續。
if [ "$n_combos" -ne 1 ]; then
  printf '%s\n' "✗ SOURCE 標頭的 (版本, commit) 不是恰好一種,不准多數決"
  if [ -s "$pairs" ]; then
    cat "$pairs"
  fi
  exit 1
fi

IFS=$'\t' read -r rel ver header_sha < "$pairs"
if [ "$ver" = "UNPARSED" ] || [ -z "${ver:-}" ] || [ -z "${header_sha:-}" ]; then
  printf '%s\n' "✗ SOURCE 標頭無法解析 (版本, commit): ${rel:-}"
  exit 1
fi

# 標頭 sha 必須本身就是 commit。git rev-parse --verify 對 40 字元 hex 只驗格式、
# 不驗物件在不在,所以存在性用 cat-file。annotated tag 的物件 sha 用 ^{commit} 會剝成
# commit,所以這裡先不剝:物件不存在 → 缺 commit;型別不是 commit → 拿 tag 物件來比。
if ! raw_type=$(git -C "$repo" cat-file -t -- "${header_sha}" 2>/dev/null); then
  printf '%s\n' "✗ commit 不存在於模板 repo: ${header_sha}"
  exit 1
fi
raw_obj=$(git -C "$repo" rev-parse --verify "${header_sha}")

# 取 tag 要比 commit,不是 tag 物件。v1.6.8 是 annotated tag:
#   git rev-parse v1.6.8            → tag 物件
#   git rev-parse 'v1.6.8^{commit}' → 標頭裡的 commit
if ! tag_commit=$(git -C "$repo" rev-parse --verify "${ver}^{commit}" 2>/dev/null); then
  printf '%s\n' "✗ 無法以 ^{commit} 解析 tag ${ver}"
  exit 1
fi
if [ "$raw_type" != "commit" ] || [ "$raw_obj" != "$tag_commit" ]; then
  printf '%s\n' "✗ tag ${ver} 要比 commit,不是 tag 物件: 標頭=${header_sha}"
  exit 1
fi

tmp=$(mktemp -d)
if ! git -C "$repo" archive "$tag_commit" 2>>"$archive_err" | tar -x -C "$tmp" 2>>"$archive_err"; then
  printf '%s\n' "✗ git archive 失敗: ${header_sha}"
  cat "$archive_err" >&2
  exit 1
fi
if [ ! -f "$tmp/scripts/sync-gates.sh" ]; then
  printf '%s\n' "✗ archive 解不出 sync-gates.sh"
  exit 1
fi

if [ -x "$tmp/scripts/sync-gates.sh" ]; then
  "$tmp/scripts/sync-gates.sh" "$root" scripts --check
else
  bash "$tmp/scripts/sync-gates.sh" "$root" scripts --check
fi
