# 12/phase-2 補完:登記真的 golden set — 回報

commit `2308401`(未 push),branch `pollux0971/golden-set-registration`,worktree base = main。

## 1. `LlmTask` 的對應查證(全部【驗】)

契約 `contracts/types.md` §7 的權威清單只有 **七個** 任務:
`ingest.cards` / `ingest.questions` / `ingest.deps` / `deepen` / `grade.fill.llm` /
`grade.apply` / `reteach.short`。

**沒有 `ingest.children`,也沒有 `regenerate`。** 實際呼叫點:

| prompt 檔 | 呼叫點 | `LlmTask` |
|---|---|---|
| `prompts/ingest/cards.md` | `packages/core/src/ingest/generate-cards.ts` | `ingest.cards` 【驗】 |
| `prompts/ingest/children.md` | `packages/core/src/ingest/children.ts` | `ingest.cards` 【驗】 |
| `prompts/ingest/regenerate.md` | `generate-cards.ts` 的 regenerate 路徑(同一個 `callAndParse`) | `ingest.cards` 【驗】 |
| `prompts/ingest/questions.md` | `packages/core/src/ingest/questions.ts:132,139` | `ingest.questions` 【驗】 |
| `prompts/ingest/deps.md` | `packages/core/src/ingest/deps.ts` | `ingest.deps` 【驗】 |

三個檔案的標題自己也寫著 `# ingest.cards — ...`。

### 由此產生的設計決定(這是我唯一問過、但沒等到回覆的一題)

登記表原本是 `Partial<Record<LlmTask, GoldenSet>>`、輸出目錄是 `<base>/<task>/<date>`。
**三個 prompt 檔共用一個 task,用任務名當 key 最多只能登記三組**,工單要的五組做不到,
守門也永遠是綠的。

我在 16:0x 用 `orca orchestration ask` 問過協調者(A:加 golden set id 當 key /
B:一組吃多個 promptFile),15 分鐘 timeout 沒有回覆,**照我當時的建議走 A**:

- `types.ts` 新增 `GoldenSetId`(6 個值),`GoldenSet` 加 `id`,`task` 仍然只放契約 §7 的值
- 輸出目錄 `<base>/<setId>/<date>`,`GoldenRunMeta` 加 `set` 欄位(`task` 保留)
- `compare` / `findBaseline` / `detectPromptDrift` / CLI 改吃 set id;`--set` 是新旗標,
  `--task` 保留為舊名(`standalone.json` 與 package.json script 沒動)
- **契約 §7 一個字都沒改**(硬約定沒碰);動到的是 prompt-quality 自己的軟約定型別

如果協調者要 B,回報後我可以改;但 B 只能有三組、每組 3 個輸入無法各自對應三種
prompt 形狀,prompt drift 也無法逐檔追。

## 2. 五組 golden set 的輸入怎麼切,為什麼

來源:`contracts/fixtures/raw/security-basics.md`(**唯讀,沒有動它**),
切成它自己的三個 `##` 小節:

| key | 小節 | 行號 | 為什麼選它 |
|---|---|---|---|
| `same-origin` | 同源政策 | 3–12 | 定義 + 三項列舉(協定/主機/埠號) |
| `cors` | 跨來源資源共享 | 14–24 | **最長**(4 段),機制 + 一條例外規則(帶憑證不能用萬用字元) |
| `preflight` | 預檢請求 | 26–34 | **最短**(3 段短句),流程順序 + 快取補充 |

理由:長度不同、結構不同,三種形狀都餵過,prompt 改壞其中一種才看得出來。

`raw-slices.ts` 是**執行時讀**、不是複製一份【驗:`raw-slices.test.ts` 10 個測試】。
好處是不會有兩份會漂的文字;風險(那個檔被動到、基準悄悄換掉)由測試擋:
釘住行號、不重疊、最後一段收在檔尾、最短那段的**逐字內容**、三段都超過 100 字上限。

各組的輸入形狀(header 照 02 的四個 builder,多一行 `golden: <input id>`):

- `ingest.cards` — `category` + `source` + 含 `##` 標題的整段切片
- `ingest.children` — `parent_id` + `parent_title` + 去掉標題的父卡正文
- `ingest.regenerate` — `title` + `limit: 100` + `previous body`(切片正文攤成一行)。
  三段正文本來就超過 100 字【驗:測試釘住】,所以是真的 regenerate 情境,不是編的
- `ingest.questions` — `card` + `title` + 卡片 body
- `ingest.deps` — 這個任務吃的是**卡片清單**不是文章,所以三個輸入是三份清單:
  (1) 三張全給、(2) 只給兩張(看它會不會為了湊數硬連)、(3) 三張倒過來列
  (看邊的方向是從語意來的還是從清單順序抄的)。id 與 title 全部來自那三個小節的標題

多一行 `golden: <id>` 的理由【驗】:FakeLlmRouter 先 filter 再拿 `candidates[0]` 的
`prompt_contains` 當群組,同一個 task 底下標記互相包含就會靜靜回錯的那一份。
有一個測試證明沒有任何標記是另一個的子字串。

## 3. prompt 檔真的被送出去了(這一輪唯一的實作)

原本 golden run 只把 prompt 檔**快照**下來、從來沒送出去 —— 那樣改了 `cards.md`
再 `--diff` 只會拿到「沒有變化」。新增 `composeGoldenPrompt(promptFileContent, inputPrompt)`,
測試斷言「送進 router 的 prompt 一定包含這次寫到磁碟的快照內容」。

## 4. 守門與反向驗證

`registry.ts` 的 `scanPromptFiles()` / `checkPromptCoverage()`,
測試在 `golden-sets/registry.test.ts`,CLI 版本是 `--list`。三種紅:
沒被登記的 prompt 檔、登記表指到不存在的檔、**掃到 0 個檔**(P-28)。

### 反向驗證(真的放了 `_probe.md`,驗完刪掉)

```
$ printf '# probe\n' > packages/core/prompts/ingest/_probe.md
$ npx vitest run packages/core/src/prompt-quality/golden-sets/registry.test.ts
     × 每一個 prompt 檔都被某個 golden set 的 promptFile 引用 12ms
     × 掃描器找得到 ingest 底下那五個檔,而且路徑是 repo 相對、用 / 分隔 6ms
     × 多一個沒被登記的 prompt 檔,unregistered 就會列出它 2ms
      Tests  3 failed | 13 passed (16)

$ npx tsx scripts/prompt-check.ts --list
...
packages/core/prompts/ 底下掃到 6 個 prompt 檔。
✗ 這個 prompt 檔沒有任何 golden set 登記,改了它不會有人發現:packages/core/prompts/ingest/_probe.md
exit=1

$ rm packages/core/prompts/ingest/_probe.md
$ git status --short packages/core/prompts/     # 空的
```

## 5. `--list` 實跑(刪掉 probe 之後)

```
$ npx tsx scripts/prompt-check.ts --list
登記的 golden set:
- ingest.cards → LlmTask ingest.cards,prompt packages/core/prompts/ingest/cards.md,3 個輸入
- ingest.children → LlmTask ingest.cards,prompt packages/core/prompts/ingest/children.md,3 個輸入
- ingest.regenerate → LlmTask ingest.cards,prompt packages/core/prompts/ingest/regenerate.md,3 個輸入
- ingest.questions → LlmTask ingest.questions,prompt packages/core/prompts/ingest/questions.md,3 個輸入
- ingest.deps → LlmTask ingest.deps,prompt packages/core/prompts/ingest/deps.md,3 個輸入
- selftest → LlmTask grade.apply,prompt packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md,3 個輸入(自我測試,不是真實任務)

packages/core/prompts/ 底下掃到 5 個 prompt 檔。
✓ 每個 prompt 檔都有 golden set 登記。
exit=0
```

## 6. `--fake` 實跑(沒花錢)

```
$ npx tsx scripts/prompt-check.ts --golden --fake --out $OUT
✓ golden run ingest.cards → <out>/ingest.cards/2026-09-04(3 個輸入)
✓ golden run ingest.children → <out>/ingest.children/2026-09-04(3 個輸入)
✓ golden run ingest.regenerate → <out>/ingest.regenerate/2026-09-04(3 個輸入)
✓ golden run ingest.questions → <out>/ingest.questions/2026-09-04(3 個輸入)
✓ golden run ingest.deps → <out>/ingest.deps/2026-09-04(3 個輸入)
✓ golden run selftest → <out>/selftest/2026-09-04(3 個輸入)
golden run 完成:處理了 18 個 golden 輸入
exit=0
```

每個目錄都有 `meta.json` / `prompt.snapshot.md` / `SCORES.md` / 每個輸入一個
`<id>.output.json`。meta 範例:

```json
{ "set": "ingest.cards", "task": "ingest.cards", "date": "2026-09-04",
  "model": "recorded", "provider": "fake", "promptFileGitCommit": "a2a6669", "mode": "fake" }
```

為了讓 `--fake` 跑得起來,新增 15 個重播 fixture 到
`packages/core/src/prompt-quality/fixtures/llm/`。**那些回應是假的、只驗結構,
不是品質基準**——品質基準要 `--live`,由協調者跑。

## 7. Stryker 分數(開發輪 DoD)

`MUTATE_TEST_GLOB='packages/core/src/prompt-quality/**/*.test.ts'`,一個檔一次:

| 檔 | 分數 | 門檻 |
|---|---|---|
| `golden-sets/registry.ts` | **99.33%** | 標準 80% ✓ |
| `golden-sets/raw-slices.ts` | **92.86%** | ✓ |
| `compare.ts` | **91.43%** | ✓ |
| `cli.ts` | **88.75%** | ✓ |
| `regression.ts` | **87.50%** | ✓ |
| `golden-run.ts` | **84.85%** | ✓ |

第一輪 `raw-slices` 只有 60.71%、`cli.ts` 58.75%(低於 stryker break 60),
兩個都補了測試才到上表的數字:raw-slices 補逐字切片斷言與「第一行不是 `##`」的情境;
cli.ts 補 `--live` 三個場景(花費那行、結構性問題逐項、離線退出碼)、`--diff` 的
`(不同)`/`(缺)`/分數輸出、以及逐行(不是 `toContain`)比對。

新增 `vitest.mutate.config.ts`:用 `MUTATE_TEST_GLOB` 縮小 stryker 每個 mutant 要跑的
測試範圍。理由是四個檔一起跑、每個 mutant 重跑全套 81 個測試檔,實測估到 **10 小時**;
縮小範圍是加速,不是放寬標準(縮掉的測試本來就殺不掉那些 mutant),不給環境變數時
跟 `vitest.config.ts` 一樣跑全部。

## 8. 驗收數字

| 檢查 | 結果 |
|---|---|
| `npm run boundaries` | ✓ 198 檔,11 條例外,無違規 |
| `npm run typecheck` | ✓ |
| `npx vitest run` | ✓ **1562 passed / 81 files**(基準 1508,新增 54) |
| `npm run accept:dry` | **0 ambiguous**(496 scenarios / 155 undefined,與變更前相同) |
| `npm run lint:docs` | ✓ 78 檔 20 條連結全在 |
| `@prompt-quality` 場景實跑 | ✓ 33 scenarios / 136 steps 全過 |

## 9. 沒做的事

- **沒有跑 `--live`**(工單交代由協調者跑)
- **沒有改 `packages/core/prompts/` 底下任何檔案**(`git status` 證明 probe 已還原)
- **沒有動 `contracts/fixtures/raw/`**
- **沒有把 phase 2 標回 `done`**。FEATURE.md 補了「補完了什麼」那一節,
  NEXT.md 的「已完成/進行中」改成跟 FEATURE.md 的 phase 表一致(原本 NEXT.md 還寫著
  phase-2 已完成,是 2026-09-04 退回那個 commit 留下的不一致),狀態欄留給審核輪
- `grade.apply` 的**真實**登記待 05(05 目前沒有 prompt 檔),registry 註解寫明了

## 10. 設計判斷清單(P-29)

| # | 判斷 | 【驗】/【推】 |
|---|---|---|
| 1 | 三個 ingest prompt 檔共用 `LlmTask` `'ingest.cards'` | 【驗】讀了三個呼叫點 |
| 2 | 契約 §7 沒有 `ingest.children` / `regenerate` | 【驗】讀了 contracts/types.md §7 |
| 3 | 因此登記表必須用 set id 當 key(方案 A) | 【推】協調者沒回覆,照我的建議走 |
| 4 | 目錄改成 `<setId>/<date>` 不會撞到既有資料 | 【驗】`golden/` 目錄不存在,沒有已 commit 的 run |
| 5 | prompt 檔要接在輸入前面才算真的在比 prompt | 【驗】原本的路徑只寫快照、沒送出去 |
| 6 | 三個切片取原檔自己的三個 `##` 小節 | 【驗】行號、標題、長度都有測試釘住 |
| 7 | 三段正文都超過 100 字,regenerate 的情境是真的 | 【驗】`countBodyWords` 測試 |
| 8 | `golden: <id>` 標記唯一,`--fake` 不會回錯 fixture | 【驗】測試證明沒有子字串包含 |
| 9 | deps 的三份清單(3/2/倒序)比三個切片更有意義 | 【推】deps 吃的是清單不是文章;倒序那份是為了驗邊的方向不是抄清單順序 |
| 10 | `missing` 只管 `promptsDir` 底下的檔(selftest 的佔位檔在外面不算失蹤) | 【驗】測試釘住 |
| 11 | 縮小 stryker 測試範圍不會虛報分數 | 【推】縮掉的測試不覆蓋這些檔;glob 蓋住 prompt-quality 全部測試 |
| 12 | `--task` 保留為 `--set` 的舊名 | 【驗】`standalone.json` 與 `package.json` 用的是 `--golden`,沒有帶 task,不會壞 |
