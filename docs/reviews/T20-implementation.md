# T20 實作報告

## 環境(開工第一行)

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET,沒有 `.env`。LLM 真呼叫 0 次。沒建立 `.env`,沒碰 `learning/`、`raw/`、`contracts/`、`prompts/`、`schema/`。

## 做了什麼

走工單「2026-10-25 顧問審後更新」的 **(a) 移除**。理由:那一節已查過,T19 之後 `word-count-min.ts` 在程式裡只剩兩處接法(常數 import、barrel `export *`),都能拿掉,不必留檔改正則。沒有自己定義「開閉在同一行」或「未閉合」圍欄。沒碰到兩邊字數不同的案例(差分測試本來就綠,改完仍綠)。沒把 6 寫成期望值。沒改 `countWords`。

1. 刪 `packages/core/src/ingest/word-count-min.ts`、`packages/core/src/ingest/word-count-min.test.ts`(邊界案例已在 `example-fence-word-count.test.ts`,沒重寫)。
2. `generate-cards.ts`:不再從 `./word-count-min.js` 取 `BODY_WORD_LIMIT`,改 `import { CARD_BODY_WORD_LIMIT } from '@contracts/index.js'`(與 `validate-card.ts`、同目錄其他 `@contracts` import 同形)。三處比較與 prompt 的 `limit` 都改用這個常數。契約裡的值是 100,與舊常數相同。第 145 行附近註解改成現況:字數唯一函式走 `countWords(parseCardText(...).body)`,上限是 `CARD_BODY_WORD_LIMIT`。檔內私有的 `countBodyWords` 仍是 T19 那條路,沒有自帶圍欄正則。
3. `index.ts`:拿掉 `export * from './word-count-min.js'`。
4. `types.ts`、`questions.ts`:只改註解。字數複本已不在;Wave 0 stub 現在只剩這份型別檔與 `fake-llm.ts`。

## 引用清單

改前 `git grep`(範圍 `packages/`、`scripts/`、`features/`)。

### `word-count-min`(要清的複本)

程式 import / export(已移除):

- packages/core/src/ingest/generate-cards.ts 第 3 行 `import { BODY_WORD_LIMIT } from './word-count-min.js'`
- packages/core/src/ingest/index.ts 第 3 行 `export * from './word-count-min.js'`
- packages/core/src/ingest/word-count-min.test.ts 第 1 行 import 自身

註解(實作檔已改寫):

- packages/core/src/ingest/generate-cards.ts 第 145 行
- packages/core/src/ingest/types.ts 第 4 行
- packages/core/src/ingest/questions.ts 第 19 行

協調者文件(不碰):

- packages/core/README.md 第 9 行
- features/02-ingest-pipeline/FEATURE.md 第 46 行
- features/02-ingest-pipeline/FEATURE.md 第 95 行

受保護測試(不碰;註解或探針字串,不是對已刪檔的 import):

- `packages/core/src/ingest/t20-no-word-count-min.test.ts`(靜態測試本身,含第 39–41 行的探針字串)
- packages/core/src/ingest/example-fence-word-count.test.ts 第 2 行
- packages/core/src/ingest/generate-cards.regenerate.test.ts 第 473 行、`:488`
- packages/core/src/ingest/generate-cards.word-authority.test.ts 第 4 行

`scripts/` 沒有命中。

### `countBodyWords` / `stripExampleFences` / `BODY_WORD_LIMIT`

這三個名字在別的模組還有自己的實作,不是 `ingest/word-count-min.ts`,工單不要求動:

- `packages/core/src/lint/validator-min.ts`、`checks.ts`、`validator-min.test.ts`;`features/steps/lint.steps.ts` 從 lint barrel import
- `packages/core/src/prompt-quality/word-count.ts`、`structural-checks.ts` 與其測試;`features/12-prompt-quality/REPORT-phase-2-registration.md` 只在文件裡提到名字
- `packages/ui-shared/src/word-count.ts` 有自己的 `stripExampleFences`(未 export)
- `packages/core/src/ingest/generate-cards.ts` 的 `countBodyWords` 是檔內私有函式,走 `parseCardText` + `countWords`,不是舊複本
- `CARD_BODY_WORD_LIMIT` 在 `packages/contracts/src/index.ts`(100)、`schema/validate-card.ts`、`features/support/golden-generalization-words.test.ts`

改後 `git grep word-count-min`:不再有對 `./word-count-min.js` 的 import / `export *`。殘留只有上面兩份協調者文件,以及受保護測試的註解與探針字串。

## 跑過的指令與輸出原文

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest packages/core/src/schema
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t20-opencode


 Test Files  37 passed (37)
      Tests  830 passed (830)
   Start at  11:13:43
   Duration  35.95s (transform 1.02s, setup 637ms, import 5.19s, tests 24.42s, environment 5ms)
```

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

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t20-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t20-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t20-opencode/scripts/gates.config.json
boundaries: 掃描 376 個檔案,允許例外 24 條
涵蓋:納管 432 / 掃描 432 檔(100.0%),未納管目錄:
  (無)

✗ 1 個違規 import:
  packages/core/src/ingest/t20-no-word-count-min.test.ts:41  import '../x/word-count-min.js'  (目標 ../x/word-count-min.js 不在任何落點內)

Wave 0 只能 import contracts/ 與自己的目錄。整合後要跨功能,把邊加進 scripts/boundaries.allow.json 並附理由。
gate=boundaries result=FAIL scanned=376
```

```
npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 276 個 markdown 檔,147 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=147
```

沒跑 cucumber、沒跑變異測試、沒跑 `check:all`。

`git diff --stat`(報告寫入前):

```
 packages/core/src/ingest/generate-cards.ts      | 10 ++--
 packages/core/src/ingest/index.ts               |  1 -
 packages/core/src/ingest/questions.ts           |  6 +--
 packages/core/src/ingest/types.ts               |  5 +-
 packages/core/src/ingest/word-count-min.test.ts | 67 -------------------------
 packages/core/src/ingest/word-count-min.ts      | 54 --------------------
 6 files changed, 11 insertions(+), 132 deletions(-)
```

沒有受保護測試檔、`schema/`、`contracts/`、`prompts/`。

## 待協調

1. **`npm run boundaries` 紅,不是這次實作造成的,也沒改測試去躲。** 唯一違規是受保護檔 packages/core/src/ingest/t20-no-word-count-min.test.ts 第 41 行:

   `expect(IMPORT_OF_RE.test(\`const m = await import('../x/word-count-min.js');\`), ...)`

   `scripts/check-boundaries.ts` 的 `stripComments` 只去 `/* */` 與 `//`,不去字串。模板字串裡的 `import('../x/word-count-min.js')` 被 `/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/` 當成真的動態 import,目標不在任何落點。這行在紅測試 commit 裡就有,本 worker 的 diff 沒有這個檔。沒有加 `boundaries.allow.json`(那會把假路徑放行進守門,而且不在工單 touches)。請協調者決定:測試 agent 改探針字串(讓 boundaries 掃不到),或守門腳本略過字串內容。本 worker 不改。

2. 受保護測試註解仍提到 `word-count-min.ts`(見上列)。靜態測試明示註解不算 import,所以 vitest 綠。若「不應再有殘留」要含這些註解,得由測試 agent 改,本 worker 不碰。

3. 沒有碰到契約 §2 未定義的圍欄(同一行開閉、未閉合)。沒有需要停下來附案例字串的差分。
