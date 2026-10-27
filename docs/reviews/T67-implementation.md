# T67 實作報告

日期:2026-10-27。模型:Grok 4.7(opencode)。分支:pollux0971/t67-opencode。
開工 HEAD:a5d4d48(merge: t67-red)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET
UNSET
$ [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET
UNSET
$ ls .env
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 .env,沒有使用任何 provider 金鑰。沒跑 --live、沒跑變異測試、沒跑 npm run check:all、沒跑 cucumber、沒跑帶 Chrome 的渲染測試、沒有 git push。沒改測試檔、features/**、.feature、contracts/、prompts/、fixtures/、protocol.vectors.json、opencode.json。

## 做了什麼

node_modules 這個 worktree 原本沒有。用 tar 從 /data/python/llm_learning-cards 複製(不用 symlink;排除 .vite、.vite-temp、node_modules/node_modules;含 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;來源沒有 apps/desktop/node_modules,不複製 src-tauri/target)。node_modules/ 在 .gitignore,沒有 add。

boundaries 沒有新邊。summary.ts 新 import 的 scheduler 與 schema 是既有的 11-review-cli → 04-scheduler、11-review-cli → 01-data-layer;teach.ts 叫 deck.ts 的 countLearnedOn 是既有的 11-review-cli → 07-teach-card。沒改 scripts/boundaries.allow.json。

1. 明天預估抽成兩邊共用的純函式。packages/core/src/session/summary.ts 第 34 行 estimateTomorrowFrom:tallyToday 數回退、buildDueList 數明天到期、estimateTomorrow 套每日上限。packages/core/src/session/engine.ts 的 summarizeDay 改成叫它,小結的 passed / failed / retryLater 仍用同一份 tallyToday。數字算法沒另寫一份。

2. 今天學了幾張。packages/core/src/teach/deck.ts 第 124 行 countLearnedOn:只數 learned_at 等於傳入那一天的紀錄。那一天由側車的 day() 傳進來(有 LC_REVIEW_TODAY 用它,否則當地日期),函式自己不叫 new Date()、不用 UTC。

3. 每個 teach.* 畫面帶 load。packages/core/src/session/teach.ts 的 TeachView 多 load,buildView 在寫完學過紀錄、重讀 reviews.json 之後才算。TeachHost 多 loadInputs。handler 第 305 行:考試卡 session 開著就用記憶體裡當日快取的 queue(小結用的那份,不是剩下還沒答的)與 session.dailyCap;沒開著就 readSessionCache,只有 kind 是 ok 才用名單,missing / invalid / stale 當 []。不叫 openDay、不叫 warnInvalidSessionCache。上限沒開著時讀 config/settings.yaml。

4. 唯讀 teach.load。packages/core/src/session/protocol.ts 的 REQUEST_METHODS 末尾加 'teach.load',schema 是空物件。handler 第 403 行只回 { learnedToday, dueTomorrow },不改卡、不改麵包屑、不寫 reviews.json / log.jsonl / 快取。算數字走 teach.readLoad,不經過會寫 warning 的 order 檔路徑。

5. 安靜呼叫。apps/desktop/src/webview/review-client.ts 第 168 行 callOnce、第 248 行 teachLoad:只送一次,不 announce、不 sleep、不走 busy 重試的 onWait。忙或出錯由 session 吃掉。

6. 視窗。apps/teach-card/src/teach-session.ts 第 89 行 parseLoad(兩個都要是 ≥ 0 的整數,否則 undefined、不丟錯)、第 307 行 refreshLoad(成功只換 load 並通知畫面;失敗或欄位壞掉保留舊數字,promise 不 reject)。apps/teach-card/src/App.svelte 第 242 行在 window focus 叫 refreshLoad。提示字樣「今天已學 N 張,明天約 M 張」在 .dock 最下面、.status-slot 底下(卡片畫面,第 369 行);學完畫面也有(第 304 行,換類別按鈕下面)。載入中、出錯、類別清單不畫這一行。樣式是既有 card-static 允許的寫法:class load-hint(第 451 行),color 只用 var(--hud-text),沒有 style 屬性、沒有顏色字面、沒有 border / outline / box-shadow。高度固定 1.25rem,數字變了不推動按鈕。

改完對被改動符號做過搜尋(含 .mjs、.js):estimateTomorrow 的舊呼叫端(summary.test.ts、features/steps/review-cli.steps.ts)仍走原函式;summarizeDay 與 createTeachRuntime 的呼叫端簽名沒破;沒有 .mjs / .js 直接呼叫這些新符號。

## 跑過的指令與輸出原文

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/session packages/core/src/teach features/support/t67-teach-load.test.ts features/support/t67-shared-estimate.test.ts features/support/t37-handler.test.ts features/support/t43-handler.test.ts apps/teach-card/src/t67-load-session.test.ts

 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t67-opencode

 Test Files  25 passed (25)
      Tests  555 passed (555)
   Start at  22:10:56
   Duration  18.63s (transform 650ms, setup 226ms, import 8.83s, tests 7.25s, environment 2ms)
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

(無輸出,結束碼 0。)

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries

> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t67-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t67-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t67-opencode/scripts/gates.config.json
boundaries: 掃描 411 個檔案,允許例外 26 條
涵蓋:納管 469 / 掃描 469 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=411
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys

> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t67-opencode/scripts/json-duplicate-keys.scope.json
✓ 48 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=48
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts

doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 337 個 markdown 檔,181 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=181
```

```
$ CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:steps

> check:steps
> tsx scripts/check-step-dup.ts

step-dup: 掃描 56 個 .feature 檔,2713 個步驟句,1893 種正規化形狀;features/steps/*.steps.ts 共 40 個檔案,1349 個可解析定義
✓ 無重複定義(1349 個定義每種形狀恰好 1 個;跨資料夾的句子 91 種)
gate=step-dup result=PASS scanned=2713
```

沒跑:cucumber、apps/teach-card/src/t67-load-render.test.ts、t47 / t49 / t44–t50 版面渲染測試。那些是驗收者在 i9 跑的。

## 待協調

1. features/steps/test-card-phase2-sidecar.steps.ts 第 133 行把 ReviewClient 的鍵釘成一份不含 teachLoad 的清單(06 phase-2 的「no action the window can send carries a path or a card id」)。工單要求 ReviewClient.teachLoad(),這份步驟檔是受保護的,我沒改。驗收若跑 06 phase-2 的側車場景,這一句會因多一個鍵而失敗。建議測試 agent 在那份清單加 'teachLoad'(排序後在 teachDeepen 與 teachNext 之間),並可順便斷言它不收參數。工單驗收條件寫的是 06 phase-3,不是 phase-2;仍可能被較寬的回歸掃到。

2. 工單派工前補充的 C9、C14 是測試缺口,實作已照規格做,不擋:stale 快取(kind 不是 ok)的名單當 [];teach.load 不重寫 reviews.json,mtime 也不會變。測試目前沒有抓這兩種改壞。

## 交件前 diff

對起點 a5d4d48,實作檔 git diff --stat(不含這份報告):

```
 apps/desktop/src/webview/review-client.ts | 21 +++++++++++++-
 apps/teach-card/src/App.svelte            | 37 +++++++++++++++++++++++--
 apps/teach-card/src/teach-session.ts      | 46 ++++++++++++++++++++++++++++++-
 packages/core/src/session/engine.ts       | 18 ++++--------
 packages/core/src/session/handler.ts      | 17 +++++++++++-
 packages/core/src/session/protocol.ts     |  3 +-
 packages/core/src/session/summary.ts      | 26 ++++++++++++++++-
 packages/core/src/session/teach.ts        | 40 ++++++++++++++++++++++++++-
 packages/core/src/teach/deck.ts           |  9 ++++++
 9 files changed, 197 insertions(+), 20 deletions(-)
```

git diff --name-only 再加上 docs/reviews/T67-implementation.md。沒有 touches 以外的檔,沒有 boundaries 登記。目錄是 apps/desktop、apps/teach-card、packages/core/src/session、packages/core/src/teach、docs/reviews。
