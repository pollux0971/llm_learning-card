---
id: T33
deps: []
touches: [scripts/dag.ts, scripts/boundaries.owners.json, scripts/zero-input-roster.ts, standalone.json]
cpu: heavy
budget_usd: 5
status: todo
owner: worker-grok
must_catch:
  - 工具寫入任何檔(輸出存檔、改 FEATURE.md / NEXT.md、建暫存檔在樹裡):「執行前後樹的每個位元組相同、沒有檔案增減」的場景必須紅
  - 同一棵樹跑兩次輸出不同(用 Map 的迭代順序、時間、隨機、絕對路徑):「兩次輸出逐位元組相同」的場景必須紅;排序要用自然排序(`phase-2` 排在 `phase-10` 前面),不是字串排序
  - 把 NEXT.md 的 `- [x]` 勾選當成已完成:「勾了也不算 done」的場景必須紅(滿足與否只看 Phase 表的狀態與 git tag)
  - 把「ADR 在決策表裡存在」、「commit 存在」當成決策 gate 已滿足,或猜它們卡住:決策 gate 只出 `HUMAN` 行,「決策表裡有也交給人」的場景必須紅
  - 整合點 `I<N>` 用 tag 名稱的子字串或前綴比對(`i4-integration-wiring` 不能算 `I4`),或加測試專用旗標略過 git:「長得像的 tag 不解鎖」場景必須紅;tag 要讀真的 git
  - 完全沒寫 gate 的 todo/ready phase 被猜成能開工:必須輸出 `PROBLEM gate-not-declared <node>`,不出 `READY`
  - 狀態 `in-progress`、`done` 的 phase 被列成 `READY` 或 `BLOCKED`;狀態 `blocked` 的 phase 沒有輸出 `BLOCKED <node> by status:blocked`
  - 有環時工具崩潰、無限迴圈、重複報同一個環,或環上的 phase 被列成 `READY`;引用不存在的 phase 時整個工具中止而不是報 `PROBLEM unresolved-ref` 後繼續
  - 檔頭少了任何一種 `PROBLEM` 種類(`cycle`、`unresolved-ref`、`no-phase-table`、`gate-not-declared`),或 `PROBLEM` 讓退出碼變成非 0(phase-1 沒有 `--check`,永遠 0;用法錯誤才是 2)
  - 摘要行 `gate=dag result=OK ready=<n> blocked=<n> human=<n> problems=<n>` 的任何一個數字與實際不符,或 mermaid 的邊數 / 方向不對、把決策 gate 畫成邊或節點
  - 跨資料夾 import 別的模組(含 `scripts/check-next-gates.ts`)、引入 YAML 或 markdown 解析套件:解析要自己寫,`npm run boundaries` 必須綠
  - 新增 `scripts/dag.ts` 但沒登記 `scripts/zero-input-roster.ts` 與 `scripts/boundaries.owners.json`:`scripts/zero-input-guard.test.ts` 與 `npm run boundaries` 必須紅
  - 在真 repo 上跑 `npx tsx scripts/dag.ts --root .` 崩潰、退出碼不是 0,或輸出裡有 `Error` / stack trace:真 repo 煙霧測試必須紅
  - 任何 `.feature`、`contracts/`、`scripts/check-next-gates.ts`(模板擁有)被改:不退步必須紅
---

# 工單 T33:13-work-dag phase-1 —— 從 FEATURE.md、NEXT.md、`I<N>` tag 算出 ready、卡在誰、待人判

> 狀態:顧問審過 2026-10-18(驗收 3 兩處改入)。協調者起草,2026-10-18;顧問指示:I3 盤點的同時開第二個 WIP。
> 作者:協調者(起草)。紅測試:-e5。實作:worker-grok(opencode grok-4.7)。驗收:-ed(含變異,標準級 80%)。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 規格正本:[features/13-work-dag/FEATURE.md](../../features/13-work-dag/FEATURE.md)(輸出形狀、NEXT.md 怎麼讀、節點滿足條件)與
> [features/13-work-dag/phase-1.feature](../../features/13-work-dag/phase-1.feature)(行為)。本工單**不複述規格**,只寫分工、檔案、驗收與不在範圍。
> 決策:ADR-065(accepted 2026-10-15;R1–R5 屬 phase-2,本張不實作)。
> 基底:main(`de5ac65` 或之後)。

## 為什麼有這張

協調者每輪要讀十幾個 FEATURE.md / NEXT.md 才知道「現在哪些能開工」,而且讀錯過(`docs/01-roadmap.md` 的現況表自九月起沒更新)。
phase-1 把這件事變成一支**只讀、只印、可重現**的腳本:`npx tsx scripts/dag.ts --root <樹>`。phase-2 之後才加工單進圖、平行規則與 `dag:check`。

## 分工(誰碰什麼)

| 誰 | 碰什麼 | 備註 |
|---|---|---|
| -e5(紅測試) | `features/steps/` 底下 13-work-dag 的步驟定義與 harness、`scripts/dag.test.ts`、`features/13-work-dag/fixtures/basic/`(若現有 fixture 不夠)、`phase-1.feature` 檔頭加回 `@standalone` tag、`scripts/boundaries.owners.json` 裡登記 `scripts/dag.test.ts` | `phase-1.feature` 的檔頭註解已寫明:加步驟定義的同一個變更把 `@standalone` 補回。這是**唯一**允許動 `.feature` 的地方,只動 tag 行,場景一個字不改 |
| worker(實作) | `scripts/dag.ts`(新檔)、`scripts/boundaries.owners.json` 登記 `scripts/dag.ts`、`scripts/zero-input-roster.ts` 登記 `scripts/dag.ts`、根目錄 `standalone.json` 加鍵 `13-work-dag`(`expect` 取 `gate=dag`)、報告 | **不改任何測試檔、步驟定義、`.feature`、fixture** |
| -ed(驗收) | 證據、`npm run mutate` | 範圍 `scripts/dag.ts`,門檻 80%,存活逐條說明 |

`scripts/dag.ts` 以外**不新增** `scripts/*.ts`(zero-input 名冊與 owners 表都只多一列)。

## 驗收條件

1. **行為**:`features/13-work-dag/phase-1.feature` 全部場景綠(`cucumber-js --tags '@work-dag and not @manual'`;一律 `--tags`,絕不給 feature 檔路徑)。
   輸出形狀照 FEATURE.md「輸出形狀」,記錄一行一筆、行首固定大寫關鍵字、排序為自然排序、同樹兩次逐位元組相同。
2. **單獨可跑**:`npx tsx scripts/dag.ts --root features/13-work-dag/fixtures/basic` 印出 `READY` / `BLOCKED` 行與 mermaid 區塊,
   最後的摘要行 `gate=dag result=OK ready=1 blocked=2 human=0 problems=0`,退出碼 0;`standalone.json` 有 `13-work-dag` 鍵,`npm run accept:standalone`(或 `check:standalone`)綠。
3. **真 repo 煙霧測試**(驗收者 -ed 跑,不是新測試):`npx tsx scripts/dag.ts --root .` 在真 repo 上退出碼 0、沒有 stack trace、摘要行 `gate=dag result=OK ...` 存在。
   依 FEATURE.md「驗收方式」:輸出的 `READY` / `BLOCKED` / `HUMAN` / `PROBLEM` **全部貼進驗收報告,由顧問核對**「與看 NEXT.md 的直覺一致嗎」。
   **不寫死預期清單**——一切以**基底 commit 的狀態**為準(派工後 `13-work-dag/phase-1` 自己會變 `in-progress`,不會再是 `READY`;顧問用基底狀態讀 NEXT.md 得到的 `READY` 至少含 `03-llm-router/phase-3` 與 `07-teach-card/phase-4`,但以顧問核對為準,不以這句為準)。
   `PROBLEM` 分類:-ed 逐條列(附 FEATURE/NEXT 檔與行號),由顧問判**工具讀錯**或**檔案本來就沒寫**:工具讀錯 → 同一張修;檔案錯(NEXT.md 沒寫 gate、寫法不齊)→ 協調者另開文件小批,**worker 不碰 NEXT.md / FEATURE.md**。
4. **只讀**:不寫任何檔(含暫存檔寫進被掃的樹)。
5. **解析自己寫**:不 import `scripts/check-next-gates.ts`(模板擁有,SOURCE 標頭)、不引入 YAML / markdown 套件;
   `npm run boundaries` 綠;`scripts/dag.ts` 與 `scripts/dag.test.ts` 在 `scripts/boundaries.owners.json` 登記到 `13-work-dag`;
   `scripts/zero-input-roster.ts` 登記 `scripts/dag.ts`;單跑 `npx vitest run scripts/zero-input-guard.test.ts` 綠(T22 的教訓:新增 `scripts/*.ts` 沒登記,整鏈會紅)。
6. **變異測試**(驗收者跑,`npm run mutate`):範圍 `scripts/dag.ts`,門檻 80%。一定要殺掉的:NEXT.md 解析(三種 phase 參照寫法、`無 gate`、checklist 項)、
   狀態判斷(`done` / `in-progress` / `blocked` / `ready` / `todo`)、tag 精確比對、決策 gate 的三種寫法、環偵測、自然排序、摘要行計數、mermaid 邊數與方向。
7. **不退步**:T30、T31、T32 與既有 phase 的非 `@manual` 場景全綠;任何 `.feature`(除 `phase-1.feature` 的 tag 行)、`contracts/`、`scripts/check-next-gates.ts` 不被改。
8. **給 phase-2 預留一個不能破的條件**(記憶裡的要求,顧問 2026-10-18 轉述):phase-2 會讀 `docs/tickets/*.md` 的檔頭。真 repo 的工單檔頭裡,
   清單項目**可以含反引號、也可以以反引號開頭**(例如本檔 `must_catch` 的第一項),`dag:check` 在真 repo 必須全綠。
   phase-1 不讀工單,所以這一條**不是 phase-1 的驗收**;但 phase-1 的解析工具函式(逐行 `- 項目` 的讀法、`#` 註解的處理)**不要**寫成會把行首的反引號或行內 `#` 當成註解或語法;
   phase-2 的工單把這條寫進它自己的驗收。這張只要求:報告「給 phase-2」一節列出 phase-1 寫的、phase-2 會重用的解析函式,各一行說明。

## 怎麼跑(給 worker)

```bash
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run scripts/dag.test.ts scripts/zero-input-guard.test.ts scripts/boundaries.test.ts
CARGO_BUILD_JOBS=2 NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@work-dag and not @manual' --format summary
npx tsc --noEmit
npm run boundaries
npx tsx scripts/dag.ts --root features/13-work-dag/fixtures/basic
npx tsx scripts/dag.ts --root .
```

- 環境:`VITEST_MAX_WORKERS=1`、`CARGO_BUILD_JOBS=2`。cucumber 一律 `--tags`(會冷編 `lc-fs`,是重活,先拿位子)。
- worker 不跑 `npm run check:all`、不跑變異測試、不跑 `npx tsx scripts/degraded-report.ts`(它會起整套 vitest;只跑 `degraded-report.test.ts` 與 `degraded-registry-rot.test.ts`)。
- 不准 live;不碰 `learning/`、`raw/`、`state/`(`--root .` 只讀 `features/`、`docs/`、`scripts/boundaries.owners.json` 與 git tag)。

## 紅測試(-e5 寫,開發 worker 不改)

| 驗收 | 量什麼 | 怎麼量(建議) | 基底上 |
|---|---|---|---|
| 1 | 每個場景 | step definitions 把 phase-1.feature 的假樹寫進 `mkdtemp`(給 `git init` 的 tag 場景用真 git),跑 `scripts/dag.ts` 子行程,比整行 | 紅(檔案不存在) |
| 1 | 摘要行與 mermaid | 邊數、方向、節點存在與否 | 紅 |
| 1 | 只讀與可重現 | 前後位元組比對、兩次輸出比對 | 紅 |
| 5 | 登記 | zero-input 名冊、owners 表(已有的守門自己會紅) | 紅 |
| 單元 | 解析函式、自然排序、環偵測 | `scripts/dag.test.ts`(vitest);worker 的實作要把它們匯出成純函式,測試才打得到——**匯出清單由 -e5 在紅測試裡定死,worker 照單實作** | 紅 |

- 自測片段一律最小,不放可以直接抄的完整實作。測試一律用 `mkdtemp`;**不准 live**。
- 丟棄式實作證明(-e5):同一份紅測試在一份丟棄式實作上全綠,交件前還原;列出突變自查(上面 `must_catch` 每一條至少一個改壞版本會紅)。

## 不在範圍

- 工單進圖、`docs/tickets/` 檔頭解析、`touches` 落點對應、R1–R5、`START` / `HELD` / `LANDING` / `NOTE` / `WARN`、`--orca`、`--check`、`npm run dag:check`:全是 phase-2(ADR-065)。
- 自動派工、合併、push;寫入任何狀態。
- 改 `NEXT.md` 的寫法或 `check-next-gates.ts`;替決策 gate 猜完成訊號;排優先權。
- `phase-1.feature` 場景的改動(協調者與顧問才能提;worker 覺得場景有錯,停下來,在報告「待協調」寫)。

## 預算

`budget_usd: 5`。grok 不設花費上限,只記錄。LLM 真呼叫:0。

## worktree

一個,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip(協調者組 `t33-start`)。同一時間只給一個 agent。派工歸協調者。
排程:落點是 `scripts/` 與 `features/13-work-dag/`;**要重活位子**(cucumber 冷編)。不碰 `packages/`、`apps/`、`contracts/`,與 I3 盤點(`docs/reviews/`、`docs/01-roadmap.md`)不重疊。
真的 `learning/` 開工、收工各量一次,前後要相同(不寫死數字)。
