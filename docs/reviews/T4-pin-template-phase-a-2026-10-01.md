# T4 階段 A 量測：`check:gates` 應量 SOURCE 宣稱的模板版本

日期：2026-10-01（Asia/Taipei）  
host：`pollux-IdeaPad`；8 cores；開工時 load 1/5/15：32.39 / 27.27 / 26.18。  
範圍：只量測、沒有實作階段 B、沒有送上游提案。

## 0. 邊界與基線

本報告沒有執行 `check:all` 或完整 vitest，沒有設定 API key，也沒有以 `--live`
執行任何東西。模板來源 `/data/python/dev-paradigm` 僅以 `git` 的唯讀查詢及
`git archive` 讀取；沒有 checkout、沒有改 index、沒有建立 tag。

開工前的 `git status --short`：

| 樹 | 輸出 |
|---|---|
| 本 worktree | 無輸出（乾淨） |
| `/data/python/dev-paradigm` | `?? .orca-brief/DOC-AUDIT-BRIEF.md`、`?? .orca-brief/FIX-174-BRIEF.md`、`?? .orca-brief/ORG-4ROLES-BRIEF.md`、`?? .orca-brief/PRUNE-BRIEF.md`、`?? .orca-brief/RELEASE-174-BRIEF.md`、`?? .orca-brief/SURVEY-BRIEF.md`、`?? .orca-brief/proposals/2026-09-22-workflow-evolution/`、`?? dev-paradigm-v2.zip` |

後者八項均是量測前既有的未追蹤項目，本文不處理它們。

模板 tag 的解析必須取 commit：

```text
$ git -C /data/python/dev-paradigm rev-parse v1.6.8
8047b77865072d1befe42ea96f967e16d9cd491e     # annotated-tag object
$ git -C /data/python/dev-paradigm rev-parse 'v1.6.8^{commit}'
88a3e11bcd2d8c0c8ad1c3cd8a87dde2246c9a0e     # commit
```

下文的「釘住」一律指後者，不把 tag object 當成內容版本。

## A1. `TEMPLATE_DIR` 的完整掃描與判定

掃描指令（只掃 Git 追蹤內容，避免未追蹤檔混入）：

```sh
git grep -n -a 'TEMPLATE_DIR' -- ':!node_modules'
node -e "const p=require('./package.json'); for (const [k,v] of Object.entries(p.scripts)) if (k.includes('gate')||k.includes('template')) console.log(k+'='+v)"
```

直接使用變數的程式位置只有以下三處；其他命中是文件、測試名稱資料或本工單。

| npm script／守門 | 位置 | 它拿模板的什麼 | 判定 |
|---|---|---|---|
| `check:gates` | `package.json:24` | 執行 `$TEMPLATE_DIR/scripts/sync-gates.sh`；目前未設時改用活的 `/data/python/dev-paradigm`。被選取的 `sync-gates.sh` 版本會決定 `--check` 額外要求什麼。 | **應釘住** SOURCE 標頭所宣稱的 commit；它問的是副本是否自同步後被改。 |
| `check:template-freshness` | `package.json:25` → `scripts/check-template-freshness.ts:95–104` | 本 repo 的 `scripts/_root.ts` 第一行版本，及 `$TEMPLATE_DIR/VERSION` 的上游活版本；並列出兩邊同名模板檔的內容差異。 | **刻意比活的**。它報告升版距離，不是內容完整性 gate。沒有 `TEMPLATE_DIR` 時 `unknown('沒有 $TEMPLATE_DIR')` 後直接 return，故設計為 rc=0 的「無法判斷」。 |
| `zero-input-roster.ts`（不是獨立 npm script） | `scripts/zero-input-roster.ts:566–573` | 為 `check-template-freshness` 的零輸入測試製造 `$TEMPLATE_DIR` 與其中的 `VERSION`（含空、缺、格式錯、指向檔案）。 | 不應讀取活模板，也不是要釘的 production gate；它應持續構造上列 report-only 的輸入形狀。 |

因此兩種缺模板時的結果不同是設計：`check:gates` 是檢查，模板執行檔不存在必須紅；
`check:template-freshness` 是報告，CI 沒有模板時必須清楚印 UNKNOWN 而不把 UNKNOWN
說成同版。

## A2. 釘住 `check:gates` 的候選與失敗方向

### 現況基線

```text
$ TEMPLATE_DIR=/nonexistent npm run check:gates
sh: 1: /nonexistent/scripts/sync-gates.sh: not found
rc=127
```

所以「模板目錄不存在」目前是明確紅燈。任何採用方案不可在這個情況無聲轉綠。

下表把「模板 repo 缺席」與「指定版本取不到」拆開；它們不是同一個 failure mode。

| 候選 | 做法 | repo 不存在 | 釘住的 tag／commit 取不到 | 必須有的紅燈對照 | 取捨／結論 |
|---|---|---|---|---|---|
| (a) 內存 archive | 將 v1.6.8 archive（及來源 commit metadata）提交至本 repo，從該副本執行 `sync-gates.sh --check`。 | **不適用／不依賴**：執行時不需外部模板 repo，這是它的優點，不該把該情形假裝成錯誤。 | **不適用／不解析**：一旦 archive 已提交，外部 tag 被刪或 repo 暫不可達不會影響執行；因此它不能用執行期結果證明外部 tag 還存在。 | archive 路徑缺失或 bundle/hash 驗證不符必須非零；在「製作／更新 archive」步驟以 `git cat-file -e "$commit^{commit}"` 驗 commit，不可只比 tag object。 | 多保存一份模板擁有檔，會漂移，且需維護 archive 的完整性與來源 metadata。若沒有額外 hash/manifest 驗證，不能採納為足以回答「版本是否可得」的方案。 |
| (b) 執行期 `git archive` | 從所有 SOURCE 第一行讀出唯一 commit；先驗證，再 `git -C <template> archive "$commit" | tar -x -C "$tmp"`，以 `$tmp` 跑 `sync-gates.sh --check`。 | **紅**：`git -C <template> cat-file -e ...` 先失敗，停止，不可 fallback 活 HEAD。 | **紅**：同一個 `cat-file -e "${commit}^{commit}"` 失敗，停止。若仍保留 tag 名，必須 `rev-parse "$tag^{commit}"`，再與標頭 commit 比較；不能直接比 tag object。 | 本次實測不存在 commit：`fatal: Not a valid object name ...^{commit}`、rc=128；不存在 repo：`fatal: cannot change to '/nonexistent'`、rc=128。階段 B 必須把這兩個非零結果做成自動化對照。 | 無副本漂移，且量的正是宣稱 commit；代價是每次需可讀模板 repo。**量測建議交由技術顧問作為優先候選**，前提是以 `set -euo pipefail`、顯式 `cat-file`、檢查 archive 解出 `scripts/sync-gates.sh`，不得吞掉 archive 失敗。 |
| (c) Git submodule／受版控 vendor checkout | 將模板以 submodule gitlink 釘到 commit，在初始化後由該 checkout 執行 gate。 | **紅**：乾淨 checkout 未 init submodule 時 `vendor/.../scripts/sync-gates.sh` 缺失；bootstrap 應清楚失敗，不得改用活 HEAD。 | **紅**：submodule 初始化／`cat-file -e "$commit^{commit}"` 失敗即停止。 | 刻意在未 init submodule 的 checkout 跑，應得到 executable missing 的非零；再以不存在 commit 驗 resolver 非零。 | 將「模板可得」交給 Git 供應鏈，少了每次 archive，但增加 clone/init 與 submodule 操作成本。是否符合本專案使用情境待裁決。 |

候選 (b) 的安全骨架是概念性量測，不是本次修改：

```sh
set -euo pipefail
commit=<由 SOURCE 標頭取得的唯一 commit>
git -C "$template_repo" cat-file -e "${commit}^{commit}"
tmp=$(mktemp -d)
git -C "$template_repo" archive "$commit" | tar -x -C "$tmp"
test -f "$tmp/scripts/sync-gates.sh"
TEMPLATE_DIR="$tmp" npm run check:gates
```

其中任何 resolver、archive、解壓或可執行檔檢查失敗都直接非零；沒有「取不到就改跑活 HEAD」
的分支。這正是排除靜默通過所需的失敗方向。

## A3. SOURCE 標頭的正確數法、版本一致性與保證範圍

### 正確定義與重數

採用 `sync-gates.sh --check` 的定義：**檔案第一行**符合
`^(//|#) SOURCE: template v` 才是模板擁有檔。以下指令也明確對 `grep` 加 `-a`：

```sh
find scripts -type f -print0 |
  while IFS= read -r -d '' f; do
    first=$(head -n 1 -- "$f")
    if printf '%s\n' "$first" | grep -aEq '^(//|#) SOURCE: template v'; then
      printf '%s\t%s\n' "$f" "$first"
    fi
  done | sort
```

結果為 **25**：14 個非測試檔、11 個 `.test.ts`；所有標頭均為
`template v1.6.8 (88a3e11)`。`scripts/_root.ts` 的完整第一行亦為
`// SOURCE: template v1.6.8 (88a3e11) sha256=...`。

三種容易混淆的量法如下。

| 寫法 | 本 host 結果 | 為何不能作為定義 |
|---|---:|---|
| 上述 `head -n 1` + `grep -aE` | 25 | 正確：位置與 header 模式都吻合守門本身。 |
| `find scripts -type f -exec grep -h '^// SOURCE: template v' {} +`（無 `-a`） | 24 | `grep: scripts/check-known-defects.ts: binary file matches`；該檔 `file` 回報 `data`，檔案被跳過而不會給出 header 行。這是同一數檔動作、只少 `-a` 就少一檔的實測。 |
| `grep -l 'SOURCE: template v' scripts/check-*.ts`（掃任何一行、限定檔名 glob） | 25，但集合錯 | 把第 83 行的正規表示式也含有該文字的 `check-template-freshness.ts` 算入；同時因 glob 不含 `_root.ts` 而漏掉真正帶標頭的 `_root.ts`。數字碰巧相同，不表示集合正確。若改掃所有 `scripts` 檔，這個寬鬆法在本 host 得 26。 |

補充：本 host 的 GNU `grep -l` 對 binary match 會印檔名，所以最後一種具體命令仍列出
`check-known-defects.ts`；它沒有重現「`-l` 自身漏 binary」的變體。這不改變規則：
`grep -l` 的問題是「任何位置」而不是「第一行」，而 binary 行為又會隨 grep 模式／實作改變。
因此不能由恰好得到 25 推論正確，唯一可重現的判準仍是 `head -1` 加 `grep -a`。

### 標頭不一致時怎麼辦

若出現 24 個 v1.6.8、1 個別版，**不可任選多數版本來釘**。階段 B 應在取 archive
前收集每一個第一行的 `(version, commit)`，要求恰有一個唯一組合；零個或多於一個都列出
檔名與值後以非零結束。升版／hotfix 的處置是技術顧問的顯式決定，不是 gate 靜默的多數決。

### 誰擔保什麼

v1.6.8 的 `sync-gates.sh --check` 對每個被它辨認的 SOURCE 檔，從第一行取內嵌 sha256，
重算 header 後內容後比對。故它擔保的是：**目前找到的 25 個 SOURCE 檔各自未被改過**。

它不擔保「25」這個數字或完整性：若有人新增本應由模板擁有、卻沒有 SOURCE 標頭的檔，
它把它視為 consumer 檔而略過，沒有期望清單可報出漏檔。兩個義務不同。

可供技術顧問裁決的補強選項：

1. 小型 `check:template-coherence`：要求所有第一行 SOURCE 的 version+commit 唯一。它能擋混版，仍不能抓漏 header。
2. 完整性 gate：由釘住 commit 的 archive 產生預期路徑 manifest，與本地第一行 SOURCE 集合雙向比對。它能抓混版與漏 header，但帶入 A2(b) 的模板可得性與明確紅燈責任。
3. 不新增 gate：接受目前只保證各已辨認檔的內容，將 header 全同版留為升版流程的人工檢查。

本階段只提出選項，不裁決。

## A4. 2×2 重現

consumer 的工作樹以 `git archive <consumer-commit>` 產生；archive 本身不帶 `.git`，
因此只在該暫存目錄 `git init -q`，讓現有 npm script 的
`git rev-parse --show-toplevel` 可取得 repo root。這不改 consumer 檔案內容。
模板 v1.6.8 依指定方式取得，沒有 checkout 模板樹：

```sh
D168=$(mktemp -d)
git -C /data/python/dev-paradigm archive v1.6.8 | tar -x -C "$D168"

C=$(mktemp -d)
git archive <consumer-commit> | tar -x -C "$C"
git -C "$C" init -q
(cd "$C" && TEMPLATE_DIR="$D168" npm run check:gates) # v1.6.8 格
(cd "$C" && npm run check:gates)                         # 活模板格
```

| 我們的樹 | 模板 | rc | 關鍵輸出 |
|---|---|---:|---|
| `e3bf2d9` | 活 `/data/python/dev-paradigm` | 1 | `✗ .../.npx-init-manifest.json 不存在,無法檢查受管檔` |
| `e3bf2d9` | v1.6.8 archive (`88a3e11`) | 0 | 37 個 `✓`、0 個 `✗`；末行 `✓ 守門內容自同步以來未被更動` |
| `17dc78f` | 活 `/data/python/dev-paradigm` | 1 | `✗ .../.npx-init-manifest.json 不存在,無法檢查受管檔` |
| `17dc78f` | v1.6.8 archive (`88a3e11`) | 0 | 37 個 `✓`、0 個 `✗`；末行 `✓ 守門內容自同步以來未被更動` |

兩個 consumer commit 的守門內容沒有變；唯一改變的是作為 executable 的模板版本。
這證明活 HEAD 新增自己的 manifest 需求，會讓原本只應回答「副本有無被改」的檢查變紅。

## 結論（供階段 B 決策）

量測支持把 `check:gates` 的 executable 固定到 SOURCE 宣稱的 **commit `88a3e11…`**，而把
活 HEAD 比較保留給刻意 report-only 的 `check:template-freshness`。若採執行期 archive，
resolver 與 archive 的任何失敗必須紅，且應先拒絕混合 SOURCE version/commit；這些是階段 B
的實作與技術裁決，本文沒有修改它們。

