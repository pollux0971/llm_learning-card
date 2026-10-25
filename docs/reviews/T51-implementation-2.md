# T51 第二輪實作報告

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,沒有 `.env`。LLM 真呼叫 0 次。沒建立 `.env`,沒碰 learning/、raw/、contracts/、prompts/。沒改測試、沒跑變異測試、沒跑 cucumber、沒跑 check:all。

## 做了什麼

只改 packages/core/src/schema/parse-card.ts 的 `EXAMPLE_FENCE_RE`(第 22 行)與上面的註解(第 12–21 行)。replace 回呼(第 42 行)沒動:第一個捕獲組仍是開頭反引號,第二個仍是尚未 trim 的內容。`countWords`、`validate-card.ts`、`word-count.ts` 沒動。

顧問 5a 裁決乙:開始行與結束行接受 CommonMark 的空白寬容,字數才跟教學卡畫面上看到的一致。N = 開始的反引號數(N ≥ 3):

- 開始:N 個反引號 + `example` + 可有空白或 Tab + 換行(CRLF 也行)。
- 結束:該行 0–3 個空白縮排 + 剛好 N 個反引號(後面不能再接反引號)+ 可有空白或 Tab + 換行或檔尾。
- 不算結束(維持第一輪):結束反引號後面接字;貼在內容行尾的反引號;縮排 4 個以上(契約未定義,不擴大)。
- 其餘維持:數量比開始少的那一行不結束;兩個反引號 + example 不是圍欄;整個圍欄從 body 移除;內容(開始行與結束行之間,已 trim)依序放進 examples。

正則(在第一輪那條上加三處,沒有改開閉數量規則):

````
/(?<!`)(`{3,})example[ \t]*\r?\n([\s\S]*?)^[ ]{0,3}\1(?!`)[ \t]*(?=\r?\n|$)/gm
````

三處分別是開始行的 `example[ \t]*`、結束行的 `^[ ]{0,3}`、結束反引號後的 `[ \t]*`。結束縮排只認空白,不認 Tab(契約與裁決都沒把 Tab 縮排定義進來)。

沒有自己定義開閉在同一行、未閉合、結束比開始多、example 後面還有別的字、縮排 4 個以上。這幾種不在本輪測試裡。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從主庫複製(排除 .vite、.vite-temp、node_modules/node_modules;含 apps/teach-card、apps/test-card、packages/ui-shared 的 node_modules;沒複製 src-tauri/target;沒把整個 node_modules 做成 symlink)。複製後 node_modules/@learning/core 與 contracts 仍是指向本工作樹的相對連結。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/schema
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t51b-opencode


 Test Files  19 passed (19)
      Tests  461 passed (461)
   Start at  13:34:56
   Duration  20.87s (transform 452ms, setup 317ms, import 1.65s, tests 15.90s, environment 2ms)
```

含 validate-card.fence-whitespace.test.ts 27 條、validate-card.contract-vectors.test.ts 25 條,以及既有 parse-card、validate-card、word-count。全綠。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest packages/core/src/lint
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t51b-opencode


 Test Files  26 passed (26)
      Tests  489 passed (489)
   Start at  13:35:20
   Duration  17.73s (transform 733ms, setup 403ms, import 4.47s, tests 8.91s, environment 3ms)
```

含 generate-cards.regenerate.test.ts 已改的兩列,以及 T20 的 example-fence-word-count.test.ts。全綠。

```
npx tsc --noEmit
```

無輸出,exit 0。

```
npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51b-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51b-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51b-opencode/scripts/gates.config.json
boundaries: 掃描 378 個檔案,允許例外 24 條
涵蓋:納管 434 / 掃描 434 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=378
```

```
npx tsx scripts/check-doc-links.ts
```

報告寫入前(掃描 284 個 markdown 檔):

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 284 個 markdown 檔,149 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=149
```

報告寫入後再跑一次:

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 285 個 markdown 檔,149 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=149
```

沒跑 cucumber、沒跑變異測試、沒跑 check:all。

另外用 parseCardText 手對過(不進 git):CRLF、開始行尾空白加結束行縮排與結束行尾 Tab 的 CRLF、檔尾沒換行(3 與 4 個反引號,含結束行尾空白與 1 格縮排)、五反引號包四反引號、四與三反引號混排、結束行尾空白/Tab、結束行縮排 1 與 3、開始行尾空白/Tab、圍欄裡「N 個反引號後面接字」與「內容貼著 N 個反引號」、兩個反引號、example 後面接字、js 圍欄、examples 較長標記。該算圍欄的都算對,不該算的都沒拿掉。

`git diff --stat`(報告寫入前,對起點):

```
 packages/core/src/schema/parse-card.ts | 11 ++++++++---
 1 file changed, 8 insertions(+), 3 deletions(-)
```

## 待協調

無。跑過的測試沒有開閉在同一行、未閉合、結束反引號比開始多、example 後面還有別的字、縮排 4 個以上。這幾種維持第一輪:配不到就不當圍欄,沒有為了讓測試綠去選邊。

結束的反引號比開始多:契約字面是同樣數量,括號寫與 CommonMark 一致(至少同樣數量)。本輪指令給的結束式是剛好 N 個(後面不能再接反引號),測試也沒有這種字串,所以維持剛好 N 個。要改成至少同樣數量就是改硬約定,不在這張。

工單已列、不在範圍、沒動:packages/core/src/lint/validator-min.ts 第 36 行與 packages/core/src/prompt-quality/word-count.ts 第 7 行仍寫死三個反引號。
