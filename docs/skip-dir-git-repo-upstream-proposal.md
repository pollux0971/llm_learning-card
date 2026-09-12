# 上游提案：以 `.git` 性質略過巢狀簽出

## 問題

目前略過規則有一部分是目錄名字清單：`DEFAULT_SKIP_DIRS` 保留了
`node_modules`、`.git`、`.claude/worktrees` 等名字，而 consumer 的
`scripts/gates.config.json` 另外列出 `tmp-learning`。但「這是不是別人的簽出」是
目錄的性質，不是名字；名字永遠列不完。

這次實測正好重現問題：`tmp-learning` 在清單裡、`learning` 不在，前者被略過而後者
被 `doc-rot` 走進去。兩者都是使用者自己的 git repo，差別只是這次有沒有人想到那個
名字。這就是「grep 只找得到你想得到的那幾個字」：找得到同一個值，不代表找得到
同一段應該共用的邏輯。

## 提議

每個會遞迴走目錄的 gate，在決定是否進入子目錄時追加這個性質判斷：

```ts
if (existsSync(join(dir, '.git'))) continue;
```

這裡必須用 `existsSync`，不要用 `statSync(join(dir, '.git')).isDirectory()`：linked
worktree 的 `.git` 可能是檔案而不是目錄；兩種形狀都代表該目錄是 git checkout，
都不應該再往下掃。

## 相容性

這是追加規則，不取代 `DEFAULT_SKIP_DIRS`。`node_modules` 等沒有 `.git`、但本來就
應該跳過的建置或依賴目錄仍由 `DEFAULT_SKIP_DIRS` 保留；`gates.config.json` 的
`skipDirs` 也仍是顯式補充。建議在上游共用 walk/helper 落地後，所有遞迴 gate 都走
同一個性質判斷。

## 本地過渡

在上游落地前，本 consumer 的 `scripts/gates.config.json` 暫時把 `learning` 加到
`skipDirs`。`learning` 是使用者自己的 git repo；正解是用性質（含 `.git` 就不進去）
判斷，已提案上游，見 ADR-0NN。落地後這一筆要刪。

## 陽性對照（本次量測）

量測基準 commit 是 `73ec1bd`；因本 worktree 沒有未版控的 `learning/`，以主簽出
`/data/python/llm_learning-cards` 作為 `--root`，並透過 `GATES_CONFIG_DIR` 指向本
worktree 的設定檔。暫時拿掉 `learning` 後，`npx tsx scripts/check-doc-rot.ts
--root /data/python/llm_learning-cards` 回報 `scanned=745`；放回 `learning` 後回報
`scanned=684`。這兩個數字是這次量到的結果，不是永久預期值；兩次都使用
`docRot.mode=report`，因此當時既有 blacklist 命中只回報、不擋 exit code。

## 名冊盤點（2026-09-13）

依檔案名列舉 `scripts/check-*.ts`（排除 `*.test.ts` 與 `*.local.test.ts`），再逐支
確認是否真的呼叫 `_root.ts` 的共用 `resolveSkipDirs`；沒有用目錄名字 grep 代替這個
盤點。`check-doc-rot.ts` 現在已經呼叫共用函式（`resolveSkipDirsForDocRot` 只是
薄 wrapper），不再是原先自己複製合併邏輯的例外。

### 已呼叫共用 `resolveSkipDirs`

- `scripts/check-boundaries.ts`
- `scripts/check-doc-links.ts`
- `scripts/check-doc-rot.ts`
- `scripts/check-module-cast.ts`
- `scripts/check-phase-status.ts`

### 走目錄但尚未呼叫共用 `resolveSkipDirs`（應另開工單）

這些目前直接使用 `DEFAULT_SKIP_DIRS` 或在檔內重寫合併，因而仍可能漏掉
`gates.config.json` 的顯式補充；本工單不把半成品名冊守門塞進來：

- `scripts/check-adr-numbers.ts` — 遞迴 root，直接以 `DEFAULT_SKIP_DIRS` 做路徑前綴排除。
- `scripts/check-dry-run.ts` — 自動偵測 cucumber cwd 時使用 `DEFAULT_SKIP_DIRS + archive`。
- `scripts/check-gherkin-dup.ts` — `resolveSkipDirsForGherkinDup` 自己合併 default/config。
- `scripts/check-json-duplicate-keys.ts` — 遞迴 root，直接以 `DEFAULT_SKIP_DIRS` 做路徑前綴排除。
- `scripts/check-known-defects.ts` — 自動偵測 cucumber cwd 時使用 `DEFAULT_SKIP_DIRS + archive`。
- `scripts/check-phase-coverage.ts` — 自動偵測 cucumber cwd 時使用 `DEFAULT_SKIP_DIRS + archive`。
- `scripts/check-step-dup.ts` — `resolveSkipDirsForStepDup` 自己合併 default/config。

### 不適用、列入豁免並附理由

- `scripts/check-all.ts` — 只負責依 chain 編排其他 gate，不走目錄樹。
- `scripts/check-deliberately-absent.ts` — 只讀登記表並檢查登記路徑是否存在，不遞迴掃描。
- `scripts/check-env-keys.ts` — 只比對根目錄 `.env.example` 與 `.env` 的鍵集合，不遞迴掃描。
- `scripts/check-next-gates.ts` — 只列舉 `features/` 的 phase/NEXT 對應，不走通用遞迴檔案樹。
- `scripts/check-standalone.ts` — 執行 manifest 指令並清理 manifest 明列的路徑，不走目錄掃描。
- `scripts/check-template-freshness.ts` — 只比較本地與模板的固定同步檔，不走內容掃描。

結論：目前「直接呼叫共用 `resolveSkipDirs`」與「不適用豁免」兩邊都有，但另有上述
7 支走目錄而只拿 `DEFAULT_SKIP_DIRS`／自帶合併邏輯的檔案；這是準確盤點結果，應由
後續工單補上真正的名冊斷言與共用 `.git` 性質判斷。

