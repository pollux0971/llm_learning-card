---
id: T53
deps: [T20, T51]
touches: [packages/core/src/ingest/, scripts/ingest.ts]
cpu: light
budget_usd: 2
status: merged
owner: worker-grok
must_catch:
  - 已經處理過的 raw 又被處理,或它產生的卡被改寫:場景 4 必須紅
  - raw 改了卻改掉卡的 body 或 examples,或沒有標 stale,或沒報幾張:場景 5 必須紅
  - raw 刪了卻刪卡,或沒標 source_missing:場景 6 必須紅
  - 標 stale 或 source_missing 時把 frontmatter 解析再序列化(日期、引號、順序、註解被改):位元組相同那條單元測試必須紅
  - 已經標過的卡又被寫一次(位元組或 mtime 變了):單元測試必須紅
  - 沒設定的分類被建了資料夾或寫進設定(掃描與主題跑法):場景 7 必須紅
  - 要求 raw 的分類沒有 raw 卻給了主題,LLM 呼叫數不是 0,或寫了卡:場景 1 必須紅
  - 分類有 raw 時拿主題去生成(卡的 source 不是 raw),或沒報主題被略過:場景 3 必須紅
  - 給檔案的跑法把已經設定好的分類的 require_raw 或 name 覆寫掉,或自動建分類時沒印出新建了哪個分類:單元測試必須紅
  - 掃描跑法寫了 raw/ 任何一個位元組;給檔案的跑法覆寫了同名但內容不同的 raw 檔:單元測試必須紅
  - 掃描跟著符號連結走,或處理了解析後不在 raw/ 那個分類資料夾裡的路徑:單元測試必須紅
  - state 的寫入不走 01 的四步原子寫入,或加了契約 §10 沒有的事件類型:單元測試必須紅
  - 實作動到 touches 以外的檔(含 contracts/、prompts/、packages/core/prompts/、features/、standalone.json、packages/core/src/scheduler/):不動的地方那條 diff 必須有輸出
  - packages/core/src/ingest/ 新寫的程式變異分數低於 80%
---

# 工單 T53:02-ingest-pipeline phase-3 —— 來源規則、增量與 stale

> 狀態:起草 2026-10-25,依協調者 2026-10-25 的交代(顧問排的)。**顧問 2026-10-25 審過:D1–D4 已裁、另加 3 條,都已寫進下面。** 規格:UI/Tauri 負責人(代筆)。編號 T53:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試(步驟定義與單元測試):測試 agent;驗收(含變異):驗收 agent。
> 依據:`../../features/02-ingest-pipeline/phase-3.feature`(8 個場景)、`../../features/02-ingest-pipeline/FEATURE.md`、`../../features/02-ingest-pipeline/NEXT.md`;`../../contracts/types.md` §2(`stale`、`source_missing`)、§7(`LlmTask`)、§10(事件類型)、§11(`require_raw`)、§11b(寫入保證)、§12(`state/ingested.json`)。CLAUDE.md 硬規則 2(不改 `raw/`)。
> 基底:main(T20、T51 合併之後;T20 會動 `ingest/` 的幾個檔,先做避免衝突)。**LLM 真呼叫 0。**

## Gate

- phase-3 需要 phase-2 `done`(2026-09-03)與 I1 通過(2026-09-04,tag `I1`)。兩個都滿足了。
- `NEXT.md` 的 phase-3 那兩格還是 `[ ]`。**派工前協調者勾起來**(這張不碰 `NEXT.md`)。
- 契約:無。這張不改契約。

## 範圍(顧問 D2:拆票)

- **這張**:場景 1、3、4、5、6、7、8,與主題跑法的「拒絕」「raw 優先」兩條分支。
- **T55**(協調者配的號,deps [T53]):場景 2(分類不要求 raw、沒有 raw,真的從主題生成)+ 新 prompt `packages/core/prompts/ingest/topic.md` + golden(硬規則 4)。真花費前先跑 `npx tsx scripts/llm-spend.ts --today`。
- 理由:增量與 stale 是純管線,離線就測得完;主題生成要新 prompt、golden、真花費與評分,節奏不一樣。現有的 `cards.md` 是「把素材拆成卡、附行號、最多 20 張」,不能直接拿來從主題生成。

## 現在的樣子(起草時讀的,main `5f3cac8`)

- `scripts/ingest.ts` 只有一種跑法:`--file <raw 檔> --out <learning 目錄> [--category <id>] [--fake]`。它先把檔案複製到 `raw/<分類>/`,再跑一個檔。
  - 複製用 `copyFileSync`:`raw/<分類>/` 已經有同名但內容不同的檔,會**靜默蓋掉**。這是真的會弄丟素材的路徑(硬規則 2)。
- 同一支會 `setCategory(absOut, { id, name: id, require_raw: true })`:**分類每次都被重寫**,已經設定的 `name` 與 `require_raw` 會被蓋掉(`../../scripts/ingest.ts:81`)。
- 去重:`state/ingested.json` 以 raw 的相對路徑為鍵,存 `sha256`、`cardIds`、`processedAt`。**只要有這個鍵就略過**,不看 sha 有沒有變(`../../packages/core/src/ingest/ingest.ts:69`)。
- 沒有「掃整個分類的 `raw/`」的跑法,沒有主題(topic)的跑法,沒有寫 `stale` / `source_missing` 的地方。
- level 1 子卡的 `source` 是 `llm`,沒有 `source_ref`(`children.ts`)。所以「這個 raw 產生的卡」= `ingested.json` 裡那個檔的 `cardIds`(level 0)。
- `state/` 的 JSON 已經走 01 的 `writeFileAtomic`(四步,§11b);log 走 `appendLineAtomic`(`ingest/state.ts`)。
- 排程(04)的 `buildDueList` 只看 `reviews.json`,不看卡的 frontmatter。場景 8 預計本來就綠。

## 要的結果

### A. 分類與來源規則(場景 1、3、7)

- 掃描與主題兩種跑法,跑之前先讀 `config/categories.yaml`。
- **分類沒有設定**(場景 7):拒絕,印出「分類沒有定義」。**輸出目錄前後完全相同**(不建骨架、不建 `raw/<分類>`、`cards/<分類>`、不寫設定、不呼叫 LLM)。跟 T6 的分類名拒絕同一個標準。
  - 場景 7 用**掃描與主題兩種跑法**各測一次。
- **分類要求 raw、`raw/<分類>/` 沒有可處理的檔,卻給了主題**(場景 1):不寫任何卡,印出「這個分類要求 raw 素材」。**LLM 呼叫數 = 0**(步驟定義用假 router 數呼叫次數,不只看沒寫卡)。
- **分類有 raw,又給了主題**(場景 3):照 raw 跑(卡的 `source` 是 `raw`),印出「有 raw,主題被略過」。
- **分類不要求 raw、沒有 raw,給了主題**(場景 2,不在這張):印出「從主題生成還沒做」,退出碼 1,不呼叫 LLM、不寫任何東西。T55 接手。
- **給檔案的跑法(`--file`)是刻意的例外**(顧問 D1 = A):分類不存在時照舊幫它建(`require_raw: true`),理由是 `standalone.json` 與 I1 的 `--file` 路徑不動。
  - 建的時候印一行「新建分類 `<id>`(require_raw: true)」,讓人看得到打錯字。
  - 分類已經存在就**不動它**(不覆寫 `name`、`require_raw`)。現在「每次都覆寫」的錯一起修。

### B. `raw/` 一個位元組都不改(硬規則 2,顧問加 2)

- **掃描跑法**:不寫 `raw/` 底下任何東西。測試前後量 `raw/` 的雜湊(檔案清單加內容),要相同。
- **給檔案的跑法**:
  - `raw/<分類>/<檔名>` 不存在:照舊複製進去。
  - 已經存在、內容相同:不複製(不寫檔)。
  - 已經存在、內容不同:**拒絕**,退出碼 1,印出是哪個檔;不覆寫,也不呼叫 LLM。

### C. 增量(場景 4,顧問 D4)

- 新的跑法:不給 `--file`。
  - 給 `--category`:只掃那一個分類。不給:掃 `categories.yaml` 裡的每一個分類。`raw/` 底下不在設定裡的資料夾報出來、不處理。
  - 只掃 `raw/<分類>/` 第一層、副檔名 `.md`、只處理一般檔案;略過 `.` 開頭的檔。
  - **不跟符號連結**:連結一律略過並報出來。解析後的路徑必須在 `raw/<分類>/` 裡,不在的不處理、報出來。
- `ingested.json` 沒有的檔:照 phase-2 的完整管線處理(level 0、考題、子卡、依賴圖;`--fake` 時照舊只跑 level 0)。
- 已經有、sha 也一樣的檔:略過,它的卡**一個位元組都不動**。

### D. 來源改了、來源刪了(場景 5、6,顧問 D3 與加 1)

- `ingested.json` 有、sha 不一樣:那個檔的 `cardIds` 每一張卡標 `stale: true`。
  - 不重新生成、不呼叫 LLM。印出「N 張卡的來源改了」。
  - **`ingested.json` 的 sha 不更新**(D3 = A):sha 代表卡是從哪一版生的;之後每次跑都報同一批。
- `ingested.json` 有、檔案不見了:那些卡標 `source_missing: true`。卡、考題都留著。印出張數。
- **怎麼標(顧問加 1)**:
  - **不准把 frontmatter 解析再序列化**(`parseCardText` 會把日期正規化,YAML 也會改引號、順序、拿掉註解)。
  - 用文字處理:在 frontmatter 結尾那一行 `---` 前面插一行 `stale: true`(或 `source_missing: true`),用檔案原本的換行(LF 或 CRLF)。
  - **整個檔除了那一行,位元組完全相同。**
  - frontmatter 裡已經有 `stale: false` 那一行(頂層、就是這個寫法):把那一行換成 `stale: true`,一樣只有那一行不同。不能插第二行,YAML 重複的鍵會讓整張卡讀不了。`source_missing` 同理。
  - 已經有別的寫法(引號、`yes`、縮排等):不動那張卡,報出來「看不懂,沒標」。
  - **已經標過的卡不再寫檔**(D3 加):位元組與 mtime 都不變,只算進報出來的張數。
  - 寫卡檔用 01 的 `writeFileAtomic`(§11b 只管 `state/`,卡檔不是硬規定;但卡也不該寫一半)。
- 卡檔本身不見了(使用者刪的):略過那一張,報出來,不重建。
- 記錄只用契約 §10 已有的類型(`ingested`、`warning`,額外欄位放檔名與卡 id)。**不加新類型**(§10 是硬約定)。

### E. stale 的卡照樣複習(場景 8)

- 不改排程。步驟定義用 04 的 `buildDueList`,證明標了 `stale` 的卡照常出現在今天的清單。預計本來就綠,是護欄。

### 結果的形狀(給測試用,不綁訊息字串)

`packages/core/src/ingest/` 匯出新的函式(名字給 worker 定),回傳的結果至少要有:

- `refused`:`'category_undefined'`、`'requires_raw'`、`'raw_conflict'`、`'topic_not_implemented'` 或沒有;
- `topicIgnored`:布林;
- `processed`、`skipped`:raw 的相對路徑;`skippedLinks`、`outsideCategory`:被略過的連結與路徑;
- `staleCards`、`missingSourceCards`:卡的 id(含已經標過的);`unreadableFlags`:看不懂、沒標的卡 id;
- `message`:給人看的一行(繁中)。

步驟定義比對這些欄位,不比對訊息原文。CLI 的退出碼:拒絕 = 1;其他(含有 stale)= 0。

## 驗收條件

| 層 | 指令 | 過的條件 |
|---|---|---|
| 單元 | `VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/ingest/` | 全綠,含新測試 |
| 場景 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@ingest-pipeline and @phase-3' --format summary` | 場景 1、3–8 綠;場景 2 的步驟留給 T55,這裡是 undefined |
| 不退步 | `--tags '@ingest-pipeline and not @phase-3'`、`--tags '@i1 and not @manual and not @llm and not @e2e'` | 全綠(拿位子) |
| 單獨執行 | `standalone.json` 的 `02-ingest-pipeline` 那一行 | 照舊輸出 3 張以上卡片;多印一行「新建分類」 |
| 變異 | `npm run mutate -- stryker.t53-ingest.json`(驗收 agent 加這個設定檔,`mutate` 只放這張新寫或改過的 `ingest/` 檔) | ≥ 80%(FEATURE 的標準門檻);存活的逐條說明 |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- contracts prompts packages/core/prompts features standalone.json packages/core/src/scheduler packages/core/src/schema` | 沒有輸出 |

**紅測試**(測試 agent):

- phase-3 的場景 1、3–8 寫步驟定義(放 `features/steps/ingest.steps.ts` 或新的 phase-3 步驟檔)。LLM 用步驟檔自己的假 router(會數呼叫次數),不新增 `contracts/fixtures/llm/` 的檔。
  - `When ingest runs` 這句**已經存在**(phase-1 用來跑單一檔)。phase-3 要它掃整個分類,步驟定義怎麼分流由測試 agent 決定,不改 `.feature`。
  - 場景 7 掃描與主題兩種跑法各一次。場景 1 斷言 LLM 呼叫數 = 0。
- 單元測試:
  - 標 stale / source_missing 前後,卡檔除了那一行**位元組完全相同**。測試用的卡要帶會被正規化的寫法:帶引號的日期、YAML 註解、不是預設順序的鍵、CRLF 的一張。
  - 已經有 `stale: false` 的卡:只換那一行;已經 `stale: true` 的卡:位元組與 mtime 都不變。
  - 掃描前後 `raw/` 的雜湊相同;`--file` 遇到同名不同內容 → 拒絕、原檔不變;同名同內容 → 不寫。
  - 符號連結(指到分類外的檔、指到分類內的檔都要)被略過並報出來。
  - 已設定的分類不被 `--file` 覆寫;沒設定時印「新建分類」那一行。
  - §10 沒有的事件類型沒有出現。
- 在基底上紅:場景 1、3、4(掃描跑法)、5、6、7 與上面的單元測試紅(`--file` 同名同內容那條、場景 8 可能本來就綠)。紅綠寫進 commit 說明。
- `.feature` 有錯就回報顧問,不改。

**改壞證明**(驗收 agent):`must_catch` 每一條各做一次,另外至少:

- sha 一樣卻標 stale → 場景 4 紅;
- 標 stale 改成解析再寫回 → 位元組相同那條紅;
- 已經標過的又寫一次 → mtime 那條紅;
- 拒絕未定義分類前先建了骨架 → 場景 7 紅;
- `--file` 改回 `copyFileSync` 直接覆寫 → 同名不同內容那條紅;
- 掃描跟著連結走 → 連結那條紅;
- 場景 1 先呼叫一次 LLM 再拒絕 → 呼叫數那條紅。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`features/**`、`.feature`、`contracts/fixtures/`。
- 實作:`contracts/`、`prompts/`、`packages/core/prompts/`、`packages/core/src/schema/`、`packages/core/src/scheduler/`、`standalone.json`、`scripts/` 裡 `ingest.ts` 以外的檔。

## 落點

`packages/core/src/ingest/` 與 `scripts/ingest.ts` → 02-ingest-pipeline(`../../scripts/boundaries.owners.json`)。用 01 的 `writeFileAtomic`,不新增 import 例外。

## 顧問的裁決(2026-10-25)

- D1 = A:`--file` 遇到沒設定的分類照舊建,已存在不覆寫;加印「新建分類」那一行;場景 7 用掃描與主題跑法測(`--file` 是刻意例外)。
- D2 = B:拆票。場景 2 + `topic.md` + golden 另開 T55(協調者配號);真花費前先跑 `npx tsx scripts/llm-spend.ts --today`。
- D3 = A:sha 不更新;已經標過的卡不再寫檔(位元組與 mtime 都不變),只報數。
- D4:照起草的,加:不跟符號連結(略過並報出來),只處理一般檔案,解析後的路徑必須在 `raw/<分類>/` 裡。
- 加 1:標記時不准解析再序列化,用文字插一行;整個檔除了那一行位元組相同。
- 加 2:掃描不寫 `raw/`;`--file` 遇到同名不同內容拒絕、同名同內容不複製。
- 加 3:場景 1 量到 LLM 呼叫數 = 0。

**起草時補的一處**(顧問的加 1 推出來的):frontmatter 裡已經有 `stale: false` 那一行時,要換那一行,不能再插一行(YAML 重複的鍵會讓整張卡讀不了);其他寫法不動、報「看不懂,沒標」。

## 不在範圍

- 場景 2 與主題生成(T55)。
- stale 卡的重新生成、清掉 stale 的流程。
- `--deps-only`(NEXT.md 的開放問題)。
- `.md` 以外的 raw 檔。

## 預算

`budget_usd: 2`(grok 不設停止線,只記錄)。沒有 LLM 花費(測試全用假 router)。

`cpu: light`(開發只跑 vitest 與這個 phase 的 cucumber);變異與不退步的 cucumber 是驗收的重活,協調者排位子。

## 測試誰寫

- 紅測試:測試 agent。改壞證明與變異:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
