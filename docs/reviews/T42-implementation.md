# T42 實作報告:教學卡等候字樣改成「考試卡還在用複習程式,稍等一下。」

日期:2026-10-23。模型:Grok 4.7(opencode)。
開工 HEAD:`65bc35b`(T42 紅測試已在起點)。
實作 commit:`437771e`。
API key 開工檢查:

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有跑變異測試(`npm run mutate`、cargo-mutants、Stryker)、沒跑 `npm run check:all`、沒有建立或使用 `.env`、沒有用 provider 金鑰。LLM 真呼叫:0。沒改測試檔、`features/steps/**`、`features/support/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`。沒有 `git push`。沒登入、沒登出、沒用 skill。沒碰 `apps/desktop/src/webview/review-client.ts`、沒動考試卡字樣。

## 做了什麼

只改 `apps/teach-card/src/teach-session.ts` 第 9 行。`git diff --stat`(commit 前):

```text
 apps/teach-card/src/teach-session.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

`BUSY_MESSAGE` 從 `考試卡正在批改,稍等一下。` 改成 `考試卡還在用複習程式,稍等一下。`(全形逗號、全形句號,跟舊字樣同樣標點)。等候時按鈕停用、`onWait` 驅動畫面、樣式、重試時點都沒動。

## 待協調

沒有。紅測試沒改。改一行之後常數、`onWait(true)` 的 `busyNotice`、超過 1500 ms 的畫面字樣都轉綠,既有等候與一層重試測試也沒紅。

## 遇到的問題

這個 worktree 沒有 `node_modules`。`package-lock.json` 與主簽出 `/data/python/llm_learning-cards` 相同,所以把那邊的 `node_modules` 做成 symlink,沒跑 `npm ci`、沒打網路。`.gitignore` 的 `node_modules/` 對不上 symlink,`git status` 會看到 `?? node_modules`;沒有 add、沒有 commit。

## 指令與輸出原文

開工金鑰檢查(exit 2,`.env` 不存在是預期的):

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/`:

```text
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t42-opencode


 Test Files  8 passed (8)
      Tests  72 passed (72)
   Start at  18:07:18
   Duration  11.31s (transform 199ms, setup 109ms, import 235ms, tests 10.17s, environment 1ms)
```

`npx tsc --noEmit`(無輸出,exit 0):

```text
```

`npm run boundaries`:

```text
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t42-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t42-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t42-opencode/scripts/gates.config.json
boundaries: 掃描 355 個檔案,允許例外 23 條
涵蓋:納管 411 / 掃描 411 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=355
```

`git grep -n "考試卡正在批改" -- apps packages features scripts`(無輸出,exit 1,沒有命中):

```text
```
