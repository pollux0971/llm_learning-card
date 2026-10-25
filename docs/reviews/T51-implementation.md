# T51 實作報告

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,沒有 `.env`。LLM 真呼叫 0 次。沒建立 `.env`,沒碰 `learning/`、`raw/`、`contracts/`、`prompts/`。

## 做了什麼

只改 packages/core/src/schema/parse-card.ts 第 17 行的 `EXAMPLE_FENCE_RE`,以及第 37 行的 replace 回呼。`countWords`、`validate-card.ts`、`word-count.ts` 沒動。

契約 §2:開始是三個以上反引號接著 `example` 與換行;結束是同樣數量的反引號自成一行。數量比開始少的那一行不結束。整個圍欄從 body 拿掉;開始行與結束行之間的內容 trim 後依序放進 `examples`,內層程式碼圍欄留在那個 example 裡。

正則是行首錨定的結束行加反向參照(開頭用負向 lookbehind,避免從較長反引號序列的中間配起):

```
/(?<!`)(`{3,})example\r?\n([\s\S]*?)^\1(?!`)(?=\r?\n|$)/gm
```

replace 回呼多收一個參數:第一個捕獲組是反引號本身,內容在第二個捕獲組。非 `example` 的圍欄(例如 `js`)與較長標記(`examples`)配不到,不移除。

沒有自己定義開閉在同一行、未閉合、結束比開始多、`example` 後面還有字、縮排。這些在跑過的測試裡沒出現。

## 跑過的指令與輸出原文

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/schema
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t51-opencode


 Test Files  18 passed (18)
      Tests  434 passed (434)
   Start at  12:49:29
   Duration  16.41s (transform 343ms, setup 249ms, import 1.26s, tests 12.56s, environment 2ms)
```

含新的 validate-card.contract-vectors 25 條,以及既有 parse-card、validate-card、word-count。CRLF、五反引號包四反引號、四與三反引號混排、後接 js 圍欄都在這 434 條裡,全綠。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest packages/core/src/lint
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t51-opencode


 Test Files  26 passed (26)
      Tests  489 passed (489)
   Start at  12:49:55
   Duration  16.29s (transform 783ms, setup 415ms, import 4.41s, tests 7.94s, environment 3ms)
```

含 T20 搬到 ingest 的 example-fence-word-count。T20 沒有把四反引號釘成 6,這次沒有被打紅。

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

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t51-opencode/scripts/gates.config.json
boundaries: 掃描 377 個檔案,允許例外 24 條
涵蓋:納管 433 / 掃描 433 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=377
```

```
npx tsx scripts/check-doc-links.ts
```

報告寫入前(掃描 281 個 markdown 檔):

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 281 個 markdown 檔,149 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=149
```

報告寫入後再跑一次:

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 282 個 markdown 檔,149 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=149
```

沒跑 cucumber、沒跑變異測試、沒跑 `check:all`。

`git diff --stat`(報告寫入前):

```
 packages/core/src/schema/parse-card.ts | 9 +++++++--
 1 file changed, 7 insertions(+), 2 deletions(-)
```

## 待協調

無。沒碰到契約沒定義的圍欄,舊測試也沒有讓兩邊算出不同數字的案例,所以沒有停下來選邊。

結束的反引號比開始多:這張沒定義。實作照工單參考寫法,要求剛好同樣數量(反向參照,後面不能再是反引號),與 packages/ui-shared/src/word-count.ts 的「剛好同樣」同一邊,不是 CommonMark 的「至少同樣數量」。跑過的測試沒有這種字串。要改成至少同樣數量就是改硬約定,不在這張。

工單已列、不在範圍、沒動:packages/core/src/lint/validator-min.ts 第 36 行與 packages/core/src/prompt-quality/word-count.ts 第 7 行仍寫死三個反引號。
