# 01 · data-layer

## 一句話

把 `contracts/types.md` 變成可執行的 zod schema 與驗證器。其他模組整合後都用它。

## 範圍

- `packages/contracts/` 的 zod schema 與 TypeScript 型別(從契約產生)
- 卡片 frontmatter 與 body 的驗證,含 example 圍欄解析
- 字數計算函式(契約 §2 的權威實作)
- 考題、reviews、weekly、log、categories、settings 的驗證
- 依賴圖驗證、循環偵測、拓樸排序
- `learning/` 目錄初始化,含把它變成它自己的 git repo 與每日 snapshot(契約 §11b、ADR-042)
- `contracts/fixtures/` 的建立(Wave 0 的附帶產出,其他功能靠它)

## 不在範圍

- 產生內容(→ 02)
- 讀寫狀態的業務邏輯(→ 04、08)
- 渲染(→ 07)

## 單獨執行

```bash
npx tsx packages/core/src/schema/cli.ts validate contracts/fixtures/cards/valid-basic.md
npx tsx packages/core/src/schema/cli.ts init ./tmp-learning
npx tsx scripts/snapshot.ts --dir ./tmp-learning
```

預期輸出:第一個印出 `OK` 與字數;第二個建立目錄樹並列出建立的檔案(phase-4 之後還會建立
git repo 與第一個 `init` commit);第三個印出「沒有變更,不建立 snapshot。」並退出 0。

## 依賴

**Wave 0(phase-1)**:無。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | phase-1 | 共用 schema 基礎 |
| phase-3 | phase-2 | 圖的驗證需要卡片驗證 |
| phase-4 | phase-1 | 掛在 phase-1 的 `init` 後面,只需要目錄樹存在 |

## Wave 0 的重複

無。這個資料夾是唯一不需要 stub 的——它只把契約變成程式。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript | `packages/contracts/src/`、`packages/core/src/schema/` |
| schema | zod | 一個格式一個 schema,匯出對應型別 |
| frontmatter | gray-matter | |
| YAML | yaml | |
| 測試 | vitest + cucumber | |
| 變異門檻 | **嚴格 95%** | 字數與驗證器是所有模組的地基 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | schema、卡片驗證器、字數、init、fixtures | Wave 0 | done | 2026-09-02 |
| 2 | 考題、狀態檔、log、設定檔 | I1 | done | 2026-09-03 |
| 3 | 依賴圖、循環偵測、拓樸排序 | I1 | done | 2026-09-03 |
| 4 | learning/ 自成 git repo、snapshot(ADR-042) | I3 | in-progress | |

## 驗收方式

全自動。變異測試範圍 `packages/core/src/schema/**`,門檻 95%。

**外加 `packages/core/src/ingest/state.ts`(同樣 95%)。** 它住在 `ingest/` 底下但
`atomicWriteJson()` 是 `state/` 全部寫入的單一入口,責任屬於 01(ADR-040 把這個歸屬留給
協調者決定,2026-09-04 決定併入)。門檻跟著責任走,不跟著目錄走(P-26)。
它不在 `schema/**` 這個 glob 裡,所以審核輪要**手動指定**:
`npx stryker run --mutate "packages/core/src/ingest/state.ts,!packages/core/src/ingest/state.test.ts"`。
字數計算與 example 圍欄解析的邊界(剛好 100 / 101 字、0 個 / 多個圍欄)必須有測試。

phase-4 的測試一律在 `mkdtemp` 出來的暫存目錄裡跑 `git init`,**絕對不在這個 repo 或任何
worktree 裡面 init**。「沒有 git」這個路徑走兩條:單元測試把 `PATH` 清空(ENOENT),
gherkin 在 `PATH` 前面插一個必定失敗的 `git` shim(非 0 退出碼)。兩條都要是 warning 不是失敗。

## 開放問題

- 字數計算對日文、韓文?目前依契約「CJK 每字算 1」,等真有該類別再議。

## 待協調

- **`cucumber.js`(共用檔,已回報協調者,尚未修)**:目前的 `export default { default: { paths, import, ... } }`
  多包了一層 `default`。這個專案 `package.json` 是 `type: module`,cucumber-js 11.3.0 讀 ESM 設定檔時,
  是把整個模組 namespace 當 definitions,`definitions['default']` 才是拿去用的 profile 設定——也就是說
  不該再包一層 `default`,直接 `export default { paths: [...], import: [...], tags: ..., format: [...] }`
  即可(用官方 `loadConfiguration` API 驗證過:改成不包那層之後 `useConfiguration.import` 才不是空陣列)。
  現況是 `npm run accept` / `accept:standalone` 對全部 12 個功能都讀不到任何步驟定義
  (`npm run accept:standalone` 目前印出 162 個 undefined 場景,不是我這裡的問題)。
  這在我開始寫 01 的步驟檔之前就已經是這樣,不是我的改動造成的。
  順便:設定裡的 `publishQuiet` 選項 cucumber-js 11 已經不需要了,修的時候可以一起拿掉(會印
  deprecation 警告)。
  **驗證方式**(不改共用檔的暫時繞法,我驗收本模組時用這個):
  `NODE_OPTIONS=--import=tsx npx cucumber-js features/01-data-layer/phase-1.feature --import 'features/steps/**/*.ts' --format progress`
  這樣可以跑出 34 scenarios / 152 steps 全過。
- **`vitest.config.ts`**:不在共用檔清單裡,但我加了 `resolve.alias`(`@contracts` `@core` 對齊
  `tsconfig.json` 的 `paths`),否則 vitest 解析不了 `@contracts/index.js` 這種 alias import
  (tsx 執行時原生支援 tsconfig paths,vitest 不會自動讀)。是純新增,沒有動到既有欄位。
- **fixture 加總/字數錯字(已直接修,不算契約變更,協調者已核准 26→23 那個)**:
  - `contracts/fixtures/cards/README.md` 的合計欄位 26 → 23(逐項數字都對,只是加總算錯)。
  - `features/01-data-layer/phase-1.feature` 最後一個 Scenario 的期望值 26 → 23,原因同上。
  - `contracts/fixtures/cards/invalid-body-101-words.md` 的 body 原本實際是 123 個字,不是檔名寫的
    101,已裁到剛好 101(用同一套逐字元演算法驗證過)。

### phase-2

- **`phase-2.feature` 的一句話改了(已直接修,不算範圍變更)**:「A newly learned card gets the
  contract's initial state」那個 Scenario 裡,`Then its stage is 1` 改成 `Then the initial stage is 1`。
  原因:`its stage is {int}` 這句 04-scheduler 的 `features/steps/scheduler.steps.ts:164` 已經先定義了
  (它讀模組內部的 `singleReview` 變數,跟我這裡的 `this.lastResult`(`createInitialReview` 的回傳值)
  是完全不同的兩件事)。cucumber 的 step 是全域註冊,不分 tag,兩邊字面完全相同就會變成
  ambiguous——我親自跑過 `--dry-run` 驗證過:不改的話,不只我這個 scenario 會炸,04-scheduler
  自己 phase-2 的「Failing returns the card to the first checkpoint」也會跟著炸(用得到同一句)。
  這是唯一動到的一行,語意沒變,只是文字換了讓兩邊步驟不撞名。
- **潛在的未來字面撞名(還沒發生,先提醒)**:04-scheduler 的 `phase-2.feature` 裡已經有
  `stuck is false`、`the consecutive count is {int}` 這類字眼,現在 `features/steps/scheduler.steps.ts`
  還沒實作到那幾句,所以目前是我在 `features/steps/data-layer.steps.ts` 定義的
  `Then('stuck is false', ...)`(讀 `this.lastResult as Review`)先頂著跑,不會 ambiguous。
  等 04-scheduler 的 worker 寫到那幾句時,如果他們的 `SchedulerOutcome.review.stuck` 也想用一模一樣
  的文字,會跟我這句撞名——屆時要嘛他們直接沿用我這個(如果 `this.lastResult` 型別對得上),
  要嘛需要把這句拉進 `common.steps.ts`(只有協調者能改)。先在這裡點名,免得日後 debug 半天。
- **`standalone.json`(共用檔,不自己改)建議加第二個驗證入口**:phase-2 新增了好幾個獨立可執行的
  CLI 子指令(`validate-question` / `validate-review` / `validate-log` / `validate-category` /
  `validate-settings` / `check-questions`,都在 `packages/core/src/schema/cli.ts`)。目前
  `standalone.json` 裡 `01-data-layer` 只有一條(phase-1 的 `validate`)。建議加一條,例如:
  ```json
  "01-data-layer-questions": {
    "cmd": "npx tsx packages/core/src/schema/cli.ts validate-question contracts/fixtures/questions/valid-basic.yaml",
    "interactive": false,
    "expect": "OK"
  }
  ```
  (對應的 fixture 檔還沒建,一起交給協調者決定要不要連 `contracts/fixtures/questions/` 一起補。)
- **`stryker.config.json`(共用檔,不自己改)目前沒有把 `packages/contracts/src` 納入 `mutate` 範圍**:
  獨立審核指出 `packages/contracts/src/index.ts` 的變異分數只有 85%(`AnswerGroupSchema` 的
  `some`→`every` 存活)。已在 `packages/contracts/src/index.test.ts` 補上混合空字串/全空的案例、
  regex 錨點(前後多字元)的案例、以及每條驗證錯誤訊息的斷言,手動指定
  `npx stryker run --mutate "packages/contracts/src/index.ts,!packages/contracts/src/**/*.test.ts"`
  跑出 174 個變異體、100% 擊殺。但因為 `mutate` 清單只有 `packages/core` 與 `packages/ui-shared`,
  平常 `npx stryker run` 不會掃到 contracts,這個分數不會自動守住。請協調者決定要不要把
  `packages/contracts/src/**/*.ts`(排除 `*.test.ts`)正式加進 `stryker.config.json`,納入變異門檻。

### phase-4(ADR-042)

- **`standalone.json`(共用檔,不自己改)建議在實作完成後加一條 snapshot 的入口**:
  ```json
  "01-data-layer-snapshot": {
    "cmd": "npx tsx scripts/snapshot.ts --dir ./tmp-learning",
    "interactive": false,
    "expect": "snapshot"
  }
  ```
  這一輪**沒有加**,因為 `npm run standalone` 會真的去跑那條指令,而 `snapshotLearningDir()`
  現在是 `throw new Error('not implemented')`,加了就是把一個共用檢查弄紅。
  `package.json` 的 `npm run snapshot` 本來就已經指向 `scripts/snapshot.ts`(先前指向一個
  不存在的檔),這一輪把那個檔補上了。
- **`features/01-data-layer/phase-4.feature` 的 `@i3` tag**:snapshot 的呼叫點在 11-review-cli
  的 phase-2(I3),所以階段標 I3。但 phase-4 **本身不依賴 11**,gate 只要 phase-1,可以先做。
- **11-review-cli 的呼叫點只寫在它的 FEATURE.md / NEXT.md,沒有寫進 `phase-2.feature`**。
  理由見 ADR-042 Consequences 第 1 點(那份 feature 的步驟一個都還沒寫,加場景會讓
  `accept:dry` 的 undefined 數字變多,或逼這一輪去佔用 phase-2 worker 要用的步驟名字)。
