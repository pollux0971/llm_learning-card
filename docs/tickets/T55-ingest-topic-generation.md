---
id: T55
deps: [T53]
touches: [packages/core/src/ingest/, scripts/ingest.ts, packages/core/prompts/ingest/topic.md, packages/core/src/prompt-quality/golden-sets/registry.ts, packages/core/src/prompt-quality/types.ts]
cpu: light
budget_usd: 2
status: merged
owner: worker-grok
must_catch:
  - 分類要求 raw 時仍照主題生成,或分類有 raw 時拿主題生成:T53 的場景 1、3 必須紅(不退步)
  - 主題生成寫出的卡 source 不是 llm、帶了 source_ref、不是 level 0,或有一張沒有考題檔:場景 2 必須紅
  - 卡數不在 1 到 5(回 0 張卻算成功、超過 5 張全寫進去):單元測試必須紅
  - body 超過 100 字的卡被寫出來(沒有走既有的重試與暫緩):單元測試必須紅
  - 同一個分類、同一個主題重跑又生成一批:單元測試必須紅
  - T53 的掃描、stale、source_missing 把 topic 開頭的鍵當成 raw 路徑(主題卡被標 source_missing 或被改):先主題後掃描的單元測試必須紅
  - 主題正規化後是空的或超過 200 字元,卻呼叫了 LLM 或寫了卡:單元測試必須紅
  - 記主題用了 state 底下新的檔(要記在 ingested.json):不動的地方那條 diff 或單元測試必須紅
  - 改了 topic.md 卻沒跑 golden run,或拿有未提交修改的 prompt 把結果寫進 golden 基準目錄:驗收必須擋下
  - 真呼叫前後沒有記 llm-spend,或今日花費加上預估會超過日上限還照跑:驗收必須擋下
  - 實作動到 touches 以外的檔(含 contracts/、cards.md、questions.md、children.md 等其他 prompt、features/、standalone.json):不動的地方那條 diff 必須有輸出
  - packages/core/src/ingest/ 新寫的程式變異分數低於 80%
---

# 工單 T55:02-ingest-pipeline phase-3 場景 2 —— 沒有 raw 時從主題生成(新 prompt + golden)

> 狀態:起草 2026-10-25,依協調者 2026-10-25 的交代(顧問 2026-10-25 對 T53 的 D2:拆票)。**顧問 2026-10-25 審過:通過;D1、D2 已裁,另加 3 條,都已寫進下面。** 規格:UI/Tauri 負責人(代筆)。編號 T55:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試(步驟定義、單元測試、golden 輸入與 `--fake` 回應):測試 agent;驗收(含變異):驗收 agent;**真呼叫的 golden run:協調者在主簽出跑,技術顧問評分。**
> 依據:`../../features/02-ingest-pipeline/phase-3.feature` 的場景 2;`T53-ingest-phase3-incremental-stale.md`(範圍與「從主題生成還沒做」那條);`../../contracts/types.md` §2、§7(`LlmTask`)、§10;CLAUDE.md 硬規則 4(改 `prompts/` 要跑 golden run,ADR-032)。
> 基底:main(T53 合併之後)。**這張會花真錢,見「花費」。**

## 為什麼有這張

- 場景 2:分類**不要求** raw、`raw/<分類>/` 沒有可處理的檔、給了主題 → 寫 1–5 張 level 0 卡,`source: llm`、沒有 `source_ref`,每張都有考題檔。
- T53 把這條留成「從主題生成還沒做」(退出碼 1、不呼叫 LLM、不寫東西)。這張接手。
- 現有的 `packages/core/prompts/ingest/cards.md` 是「把素材拆成卡、附行號、最多 20 張」,不能拿來從主題生成,所以要新 prompt。新 prompt = 硬規則 4,要跑 golden run(真呼叫)。

## 要的結果

### 1. 生成

- 跑法:`scripts/ingest.ts --out <learning 目錄> --category <id> --topic "<主題>"`(T53 加的主題跑法)。分類與 raw 的檢查照 T53,不改。
- **主題先正規化、再驗**(顧問加 2、加 3):
  - 正規化:trim、Unicode NFC、連續空白(`\s+`)併成一個空白。
  - 正規化後是空的、或超過 200 字元(以 Unicode code point 數):**拒絕**,退出碼 1,**LLM 呼叫數 = 0**,不寫任何東西。
  - 送進 prompt 的是正規化後的主題。
- LLM 的 task 用既有的 `ingest.cards`(§7 的 `LlmTask` 是硬約定,不加新的)。模板是新的 `packages/core/prompts/ingest/topic.md`。
- 回來的卡:
  - 每張:`title`、`body`、`examples`;沒有 `lines`。
  - body 過不了 §2 的 100 字:走既有的重試與暫緩(`generate-cards.ts` 那一套,`regenerate.md` 不改);暫緩的照舊寫 `state/needs-review.json`。
  - **超過 5 張**:只留前 5 張,寫一筆 `warning`。**0 張**(或全部暫緩):失敗,退出碼 1,不寫卡。
- 寫卡:level 0、`source: llm`、**沒有** `source_ref`、`created` 今天、`prereqs: []`;id 照 `nextCardIds`。
- 寫完照 raw 的完整管線跑後半:考題、子卡、依賴圖(顧問 D1)。
- 記錄只用 §10 已有的類型。

### 1b. 同一個主題不重複生成(顧問 D2 與加 1)

- 記在既有的 `state/ingested.json`,鍵是 `topic:<分類>:<正規化後主題的 sha256>`,值的形狀跟 raw 的一樣(`sha256`、`cardIds`、`processedAt`)。
  - 契約 §12 只定了目錄與檔名,沒定 `ingested.json` 的內部格式,所以加鍵不是改硬約定。**不准另開 `state/` 底下的新檔**(那就動到 §12)。
  - 寫入照舊走 01 的 `writeFileAtomic`。
- 同一個分類、正規化後同一個主題再跑:略過,印「這個主題已經生成過」,列出那幾張卡的 id,不呼叫 LLM。
- **T53 的掃描、stale、source_missing 都要略過 `topic:` 開頭的鍵**。不然主題的鍵會被當成「raw 檔不見了」,主題卡全被標 `source_missing`。這張要改 T53 寫的那幾段(都在 `packages/core/src/ingest/` 裡)。

### 2. prompt(`topic.md`)

- 規則跟 `cards.md` 同一套能照抄的部分照抄(§2 的字數說明、一張卡一個概念、examples 不重複 body、只回 JSON 陣列)。
- 不同的:輸入是一行主題,不是素材;要 1–5 張;不要 `lines`;只寫一般公認的知識,不確定的不寫。
- 其他 prompt 檔一個位元組都不動。

### 3. golden

- 登記表(`../../packages/core/src/prompt-quality/golden-sets/registry.ts`)加一組 `ingest.topic`:`task` 是 `ingest.cards`,`promptFile` 是 `topic.md`。`types.ts` 的 `GoldenSetId` 加 `'ingest.topic'`。
- 三個輸入:**非資安**的公開常識主題(例如一個自然科學、一個生活或理財、一個技術)。輸入與 `--fake` 回應由**測試 agent** 寫(T18 的先例:評分用的輸入不由被評分的一方挑)。不取自 `raw/`、`learning/`、帳本。
- 登記表照其他組的寫法自己組 header,**不 import `ingest/`**(不新增 import 例外)。
- 機器檢查:每個輸出是合法 JSON、1–5 張、每張 body 過 `validateCard` 的字數、沒有 `lines`、同一個輸出裡不重複(既有的 `checkDuplicates`)。
- 人的評分:技術顧問照 `golden/ingest.cards/2026-10-15/SCORES.md` 的格式評(一個概念、正確、例子具體、不重複)。

## 花費(真呼叫只在這一節)

| 項目 | 值 |
|---|---|
| 誰跑、在哪裡跑 | **協調者,只在主簽出**(只有主簽出有憑證)。worker、測試 agent、驗收 agent 都只跑 `--fake`,不碰金鑰 |
| 指令 | `npx tsx scripts/prompt-check.ts --golden --set ingest.topic --live --out <golden 基準目錄以外的暫存目錄>` |
| 一輪的呼叫數 | 3 次(三個輸入各 1 次 `ingest.cards`) |
| 呼叫數上限 | **最多 3 輪,共 9 次**。要第 4 輪先問顧問 |
| 預估 | 一輪約 0.03 美元(依據:`golden/ingest.cards/2026-10-15/meta.json`,同一個 task 三次呼叫 `estimated_cost_usd` 約 0.025);三輪約 0.10 美元 |
| 日上限 | `LLM_DAILY_CAP_USD` = 1 美元 |
| 跑之前 | `npx tsx scripts/llm-spend.ts --today`,記下金額與筆數。退出碼 1(已達上限)或 2(算不出來)就不跑。**今日已花 + 這一輪的預估 ≥ 1 美元就不跑,問使用者**(CLAUDE.md:超過日上限是使用者的決定) |
| 跑之後 | 再跑一次 `llm-spend.ts --today`,記下金額、筆數、差額;差額跟 `meta.json` 的 `estimated_cost_usd` 對得上 |
| 證據 | 每一輪的前後金額、呼叫數、`meta.json`、`prompt.snapshot.md` 寫進驗收證據 |

- 合併前那一輪:協調者在乾淨主簽出暫時套上 worker 的 `topic.md`,`--out` 放在 golden 基準目錄以外,跑完還原(T12 的做法;`meta.json` 的 commit 會是 `-dirty`,不寫進基準)。
- 合併後:在乾淨的 main 重跑一次,存成 `golden/ingest.topic/<日期>/` 的基準,顧問寫 `SCORES.md`。
- 每改一次 `topic.md`,就再跑一輪(硬規則 4),算進上面的 3 輪上限。
- 主簽出有真的 `.env` 與真的 learning/:只跑上面那一行指令,不跑別的;learning/ 前後量檔案數、雜湊、帳本行數(帳本會多出這幾次 `llm_call`,其餘不變)。

## 顧問的裁決(2026-10-25)

- 通過。花費規則照「花費」一節(一輪 3 次、最多 3 輪、第 4 輪先問顧問、跑前跑後 `llm-spend`、≥ 1 美元問使用者、只由協調者在主簽出跑)。`SCORES.md` 顧問評。
- D1 = 完整後半(考題、子卡、依賴圖)。
- D2 = 記在 `ingested.json`(加鍵不是改硬約定;不准另開 `state/` 新檔)。
- 加 1:T53 的掃描、stale、source_missing 略過 `topic:` 開頭的鍵。
- 加 2:鍵裡的 sha 用正規化後的主題(trim、NFC、連續空白併成一個)。
- 加 3:主題正規化後空的、或超過 200 字元 → 拒絕,退出碼 1,LLM 呼叫 0。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/ packages/core/src/prompt-quality/` | 全綠,含新測試 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@ingest-pipeline and @phase-3' --format summary` | 8 個場景全綠(T53 的 7 個加場景 2) |
| 不退步 | `--tags '@ingest-pipeline and not @phase-3'`、`--tags '@i1 and not @manual and not @llm and not @e2e'` | 全綠(拿位子) |
| golden(假) | `npx tsx scripts/prompt-check.ts --golden --set ingest.topic --fake --out <暫存目錄>` | 3 個輸出,機器檢查都過 |
| golden(真) | 見「花費」 | 機器檢查都過;顧問評分過 |
| 變異 | `npm run mutate -- stryker.t55-ingest-topic.json`(驗收 agent 加這個設定檔,`mutate` 只放這張新寫或改過的 `ingest/` 檔) | ≥ 80% |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- contracts features standalone.json packages/core/prompts/ingest/cards.md packages/core/prompts/ingest/questions.md packages/core/prompts/ingest/children.md packages/core/prompts/ingest/regenerate.md packages/core/prompts/ingest/deps.md packages/core/src/schema packages/core/src/scheduler` | 沒有輸出 |

**紅測試**(測試 agent):

- 場景 2 的步驟定義(假 router,會數呼叫次數)。在 T53 合併後的 main 上紅,紅的原因是 T53 的「從主題生成還沒做」。
- 單元測試:
  - 1–5 張的上下限(0 張、6 張)、超過 100 字走重試與暫緩、寫出的卡沒有 `source_ref`、每張都有考題檔。
  - 重跑同一個主題略過;只差空白或 NFC 的兩個主題算同一個;不同主題各自生成。
  - **先跑一次主題,再跑一次掃描**:主題卡一個位元組都不變,沒有被標 `source_missing`,`ingested.json` 的 `topic:` 鍵還在。
  - 主題正規化後空的、剛好 200 字元(過)、201 字元(拒絕);拒絕時 LLM 呼叫數 = 0、輸出目錄前後相同。
  - `state/` 底下沒有多出新檔。
- golden:`ingest.topic` 的三個輸入、`--fake` 回應(放在 `packages/core/src/prompt-quality/fixtures/llm/`〔`DEFAULT_FAKE_FIXTURE_DIR`〕;`golden-fake/` 只是 `--fake` 的輸出目錄、不進 git;`prompt_contains` 的標記唯一)、登記表的測試。
- 紅綠寫進 commit 說明。`.feature` 有錯就回報顧問,不改。

**改壞證明**(驗收 agent):`must_catch` 每一條各做一次(真呼叫那兩條看證據,不重跑),另外至少:6 張全寫 → 上限那條紅;寫出 `source_ref` → 場景 2 紅;重跑又生一批 → 那條紅;掃描不略過 `topic:` 鍵 → 先主題後掃描那條紅;sha 用沒正規化的主題 → 「只差空白」那條紅;拿掉長度檢查 → 201 字元那條紅。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`features/**`、`.feature`、`contracts/fixtures/`、`packages/core/src/prompt-quality/golden-fake/`、`packages/core/src/prompt-quality/fixtures/`。
- golden 基準目錄 `packages/core/src/prompt-quality/golden/`:只有協調者在合併後寫。
- 實作:`contracts/`、`topic.md` 以外的 prompt 檔、`packages/core/src/schema/`、`packages/core/src/scheduler/`、`standalone.json`。

## 落點

`packages/core/src/ingest/`、`scripts/ingest.ts`、`packages/core/prompts/ingest/topic.md` → 02-ingest-pipeline;`packages/core/src/prompt-quality/` → 12-prompt-quality(`../../scripts/boundaries.owners.json`)。不新增 import 例外。

## 不在範圍

- `cards.md` 與其他 prompt 的改動。
- 主題生成的卡之後的 stale(沒有 raw,不會 stale)。
- 一次給多個主題。

## 預算

`budget_usd: 2`(grok 開發,不設停止線,只記錄)。**真呼叫另計**:預估一輪約 0.03 美元、最多 3 輪約 0.10 美元,受 1 美元日上限管(見「花費」)。

`cpu: light`(開發只跑 vitest、這個 phase 的 cucumber、`--fake` 的 golden);變異與不退步的 cucumber 是驗收的重活,協調者排位子。

## 測試誰寫

- 紅測試、golden 輸入與 `--fake` 回應:測試 agent。改壞證明與變異:驗收 agent。真呼叫的 golden run:協調者(主簽出)。評分:技術顧問。開發 worker 以紅測試分支為基底,不改測試。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
