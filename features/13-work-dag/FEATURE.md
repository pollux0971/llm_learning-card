# 13 · work-dag

## 一句話

從現有的檔案算出「工作依賴圖」,告訴協調者**現在哪些能開工、哪些能同時做、卡在誰**。圖是推導出來的,
不是另一份要維護的狀態。

## 範圍

- **讀**三種既有來源,算出節點與邊:
  - 各 `features/<NN-name>/FEATURE.md` 的 Phase 表(**phase 狀態的唯一來源**,ADR-025 不變);
  - 各 `features/<NN-name>/NEXT.md` 的 gate 宣告(**phase gate 的正本**,ADR-025 不變);
  - git tag `I<N>`(整合點通過的訊號,例如 `I1`);
  - phase-2 起再加:`docs/tickets/` 每張工單最上面的檔頭(格式見下)與 `scripts/boundaries.owners.json`(落點表)。
- **輸出**:`READY`(能開工)、`BLOCKED`(卡在誰)、`HUMAN`(待人判的決策 gate)、`PROBLEM`(圖本身有毛病),
  以及一段 mermaid。phase-2 起再加 `START`(現在可同時開的)、`HELD`(能開工但被平行規則擋住)、`--orca` 輸出。
- **平行規則 R1–R5**(原文在下,是顧問 2026-10-15 的裁決,ADR-065 同文)。
- **`npm run dag:check`**(phase-2):把圖的毛病變成紅燈,接進 `check:all` 的 `chain`。

## 不在範圍

- 自動派工、合併、push。這個工具**只讀、只印**,不執行任何 `orca` 指令(`--orca` 只印)。
- 寫入任何狀態。圖不存檔,每次從檔案重算。
- 改 `NEXT.md` 的寫法。工具去適應現有寫法,不要求別人改(`check-next-gates.ts` 認哪幾種寫法,就吃哪幾種)。
- 動 `contracts/`。本功能沒有新的跨模組型別。
- 動 `scripts/check-next-gates.ts`(模板擁有,有 SOURCE 標頭,勿手改)。dag 自己解析 NEXT.md,**不 import 它**。
- 替「決策 gate」猜完成訊號(見下「決策 gate」)。
- 決定誰做哪張工單、先後次序的優先權。優先權屬於協調者(ADR-052);工具只給一個固定、可重現的排序。

## 單獨執行

```bash
npx tsx scripts/dag.ts --root features/13-work-dag/fixtures/basic
```

預期輸出:每行一筆記錄(形狀見「輸出形狀」),最後一行 `gate=dag result=OK ready=<n> blocked=<n> human=<n> problems=<n>`,
退出碼 0。

**(歷史說明,T33 已補上 `@standalone` 與 `standalone.json`,2026-10-21)`phase-1.feature` 當時刻意沒有 `@standalone` tag**:`check:dry-run` 的驗收集合是 `@standalone and not @manual`,
集合裡有 undefined 步驟就紅(實測:加上 tag 時 34 個場景、175 個步驟 undefined,gate FAIL;不加時基準 PASS,158 個場景)。
phase-1 的實作者在**加步驟定義的同一個變更**裡把 `@standalone` 補回檔頭 tag 行。

**同時要加進根目錄的 `standalone.json`**(鍵 `13-work-dag`,`expect` 取輸出裡一定出現的字串 `gate=dag`)——
那是驗收時實際讀取的來源,這裡只是說明。**phase-1 的實作者做這件事;本規格輸出時沒有程式,所以還沒加。**

phase-1 實作時另要在 `scripts/boundaries.owners.json` 登記 `scripts/dag.ts`、`scripts/dag.test.ts` →
`13-work-dag`(phase-2 再加 `scripts/dag-check.ts` 等實際新增的檔)。

## 依賴

**Wave 0(phase-1)**:無。只依賴 `contracts/`,而且實際上什麼都不 import(解析是自己寫的,理由見「不在範圍」)。

| 後續 phase | 需要 | 原因 |
|---|---|---|
| phase-2 | phase-1 `done`、ADR-065 定案 | 工單進圖的規則(R1–R5)是顧問裁的,ADR 是它的家 |

## Wave 0 的重複

| 東西 | 位置 | 整合時移除於 |
|---|---|---|
| 假樹 fixture | `features/13-work-dag/fixtures/` | 不移除(測試資料,不是 stub) |

**偏離 `features/README.md` 的一條原則,理由與請顧問確認**:README 的 phase-1 原則 3 說「只吃 `contracts/fixtures/`」。
本功能的輸入是「一整棵 `features/` + `docs/tickets/` 的樹」,不是契約定義的資料格式,放進 `contracts/fixtures/` 會讓契約的
fixture 目錄混進與契約無關的東西。所以 fixture 放在自己的資料夾底下(顧問派令指定)。這是 FEATURE.md 說明的例外,
**依本檔 README 的規定,例外要在 `docs/02-decision-map.md` 記一筆**——見 ADR-065 的 Consequences。

## 技術棧

| 項目 | 選擇 | 備註 |
|---|---|---|
| 語言 | TypeScript(`tsx` 執行) | 腳本層,不進 `packages/core` |
| 測試 | vitest + cucumber + stryker | |
| 變異門檻 | 標準 80% | 顧問裁決。解析 NEXT.md 與判定 R2/R3 的函式要在變異範圍內 |

## Phase

| Phase | 標題 | 階段 | 狀態 | 完成日 |
|---|---|---|---|---|
| 1 | 從 FEATURE.md、NEXT.md、`I<N>` tag 算出 ready、卡在誰、待人判、mermaid | Wave 0 | done | 2026-10-21 |
| 2 | 工單進圖、平行規則 R1–R5、`--orca`、`dag:check` 接進 `check:all` | 不綁整合點 | todo | |

## 輸出形狀(phase-1 與 phase-2 的步驟定義都照這個斷言)

節點名稱(固定寫法,不翻譯):

| 種類 | 寫法 | 例 |
|---|---|---|
| phase | `<NN-name>/phase-<N>` | `10-desktop-shell/phase-2` |
| 整合點 | `I<N>` | `I4` |
| 工單(phase-2) | 檔頭的 `id` | `T2b` |
| 決策 gate | `ADR-<NNN>`、`§<N>`(含字母後綴,如 `§11b`)、`commit <7 碼以上 hex>` | `ADR-040` |

每筆記錄一行,**行首是固定的大寫關鍵字**,欄位以單一空格分隔,排序固定(關鍵字、再節點名稱的**自然排序**:數字段按數值比,`T2` 排在 `T10` 前面;字母與其他字元按碼位),
所以同一棵樹跑兩次輸出逐位元組相同:

```
READY <node>                          # 所有 gate 都滿足,狀態是 todo 或 ready;表上狀態不是 ready 時加 (table says <status>)
BLOCKED <node> by <node>[,<node>...]  # 直接擋住它的、尚未滿足的節點(整合點沒有 tag 也算);狀態 blocked 時寫 by status:blocked
HUMAN <node> decision <ref>           # 這個節點有決策 gate,工具不判定
PROBLEM <kind> <detail>               # kind:cycle、unresolved-ref、no-phase-table、gate-not-declared、...
gate=dag result=OK ready=<n> blocked=<n> human=<n> problems=<n>
```

後面接一段 mermaid(` ```mermaid ` 圍欄,`graph TD`),邊的方向是「被依賴者 --> 依賴者」,節點 id 要加引號
(資料夾名有 `-` 與 `/`)。**只畫可判定的節點(phase、整合點、工單);決策 gate 不畫成邊**,它們只出現在 `HUMAN` 行。

phase-2 增加的記錄:

```
START <node>                              # 現在可以開,而且和已在跑的、這輪已選的都不違反 R2/R3/R4
HELD <node> by <R2|R3|R4> with <node>[,...]   # 能開工(R1)但被規則擋住;每違反一條規則印一行,順序 R2、R3、R4
LANDING <ticket> <landing>                # 每張 status 不是 merged / dropped 的工單,touches 最長前綴對到的落點
NOTE <kind> <detail>                      # 資訊,永不紅(目前沒有必須印的 NOTE)
WARN <kind> <detail>                      # R4 / R5 違反:WARN r5-depth <id> <深度>、WARN r4-dispatched <數量>
PROBLEM bad-header <id|檔名> missing|invalid <欄位>   # 另有 missing-header <檔名>、unresolved-ref、duplicate-id、cycle、r2-overlap <id> <id> on <落點>(落點是 infra 時寫 on infra:<重疊的那個項目,目錄前綴取較短的那個>)、r3-heavy <id> <id>、no-landing <id> <前綴>
```

工單缺 `id` 時用檔名當名字。`id` 必須符合 `^[A-Za-z][A-Za-z0-9_]*$`(它會當 bash 變數名)。

**`--orca` 印的是一段可以直接執行的 bash**(顧問 2026-10-15 裁決),按拓樸序、同層自然排序,只含 `status: todo` 的工單,
每張一行,deps 用前面已經建好的變數,**已經 `merged` 的依賴不列**:

```
T1=$(orca orchestration task-create --spec "$(cat docs/tickets/T1-….md)" --deps "[]" --json | jq -r '.<id 欄位>')
T2=$(orca orchestration task-create --spec "$(cat docs/tickets/T2-….md)" --deps "[\"$T1\"]" --json | jq -r '.<id 欄位>')
```

`<id 欄位>` 的名字**由 phase-2 的實作者開工前用一次真的 `--json` 量出來,不要猜**,量到的值與指令寫進報告。
工具**只印不執行**。依賴一張 `dispatched` / `review` 的工單(它在圖上但不是這批要建的)不列進 `--deps`(它已經在跑,不是 orca 要等的新 task)。
`--check` 讓任何 `PROBLEM` 變成退出碼 1(沒有 `--check` 時永遠 0;用法錯誤 2);`WARN` 與 `NOTE` 永遠不紅。

### 節點的滿足條件

| 節點 | 算「已滿足」的條件 |
|---|---|
| phase | FEATURE.md 的 Phase 表該列狀態是 `done` |
| 整合點 `I<N>` | git tag `I<N>` 存在(讀真的 git,不加測試專用旗標) |
| 工單 | 檔頭 `status: merged` |
| 決策 gate | **永遠不算滿足,也不算卡住**——只列 `HUMAN`。ADR 存在、commit 存在都不等於「那個決定已經做了」 |

### NEXT.md 怎麼讀(去適應現有寫法)

認 `**phase-N** 需要:` 開頭的段落(同一行內容,或接一串 `- [ ]` / `- [x]` checklist,每一項各是一條 gate 宣告)。
phase 參照三種寫法都吃:`<NN-name>/phase-N`、`NN phase-N`、單獨的 `phase-N`(指自己這個資料夾)。
`I<N>` 是整合邊。`ADR-NNN`、`§N`、7 碼以上 hex 是決策 gate。checklist 的勾選狀態**不讀**——
已滿足與否只看狀態來源(Phase 表與 tag),勾選框是人手維護的、會漂。

`**phase-N**:無 gate` 這種寫法表示明說沒有 gate,該 phase 沒有任何邊。
**完全沒寫任何關於 phase-N 的 gate 的 phase,不猜它能開工**,輸出 `PROBLEM gate-not-declared <node>`。
只對狀態是 `todo` / `ready` 的 phase 檢查;`done` 與 `in-progress` 的 phase 不需要 gate 也不報。

## 工單檔頭(phase-2 起;顧問 2026-10-15 裁決的格式)

每張工單 `docs/tickets/*.md` 的最上面(第一行就是 `---`):

```
---
id: T2b
deps: [10-desktop-shell/phase-1]       # 工單 id、phase 參照或 IN
touches: [apps/desktop/src-tauri/]     # 路徑前綴
cpu: heavy | light                      # heavy = 跑完整鏈、Stryker、cargo-mutants、計時量測
budget_usd: 5
status: todo | dispatched | review | merged | dropped
owner: worker-grok | worker-claude | worker-codex | 統籌 | 前端 | 驗收   # worker-codex 是歷史值(Codex 已停用)
must_catch: [ … ]                       # 驗收必須證明測試抓得到的突變
---
```

- `must_catch` 的由來:T2b 的草稿漏了 Unicode Mark 類別與 `com9` 兩個該被測試抓住的突變,事後才補。這欄逼寫工單的人
  在派工前就列出「驗收要證明測試抓得到什麼」,驗收的人拿它當清單。
- **檔頭是 YAML 的一個受限子集**(dag 不 import 任何 YAML 套件,自己解析):`key: value` 一行一欄;清單可以寫成一行
  `[a, b]`,也可以寫成鍵下面逐行的 `- 項目`(`must_catch` 的項目常含逗號,用逐行);空白加 `#` 之後是註解;
  引號、巢狀、多行字串**不支援**,出現就是 `invalid`。
- 欄位值不合法(`cpu: medium`、`status: wip`、`owner` 不在清單、`budget_usd` 不是非負數、`deps` 不是清單)或缺欄位,`dag:check` 紅。
- **`budget_usd: 0` 表示「歷史工單,沒有預算」,只有 `status` 是 `merged` 或 `dropped` 時才合法**;`todo` / `dispatched` / `review` 寫 0 是 `invalid budget_usd`。
- **每張 `docs/tickets/` 底下的工單檔都必須有檔頭**;沒有檔頭的檔是 `PROBLEM missing-header <檔名>`,`dag:check` 紅(顧問裁決:
  否則「新工單忘了檔頭」是靜默缺口)。已合併的舊工單也要補,`status: merged`。
- 只有檔頭、沒有別的格式要求:工單內文怎麼寫不變(「工單唯一的正本」那條規矩不變)。

## 平行規則(顧問裁決,原文)

- **R1** ready = `deps` 全滿足(phase `done` / tag `I<N>` 存在 / 工單 `merged`)。
- **R2** 兩張工單同時跑,`touches` 用 `scripts/boundaries.owners.json` **最長前綴**對到的落點**不能重疊**;
  落點是 `contracts` 的,和任何工作都互斥。
- **R3** `cpu: heavy` 同一時間最多 1 個在 `dispatched` 或 `review`(驗收跑變異也算)。
- **R4** phase 的 WIP ≤ 2(CLAUDE.md);`dispatched` 的工單 ≤ 3。
- **R5** 依賴鏈深度 ≤ 4。

`dag:check` 要紅的情況(顧問原文):有環、引用解析不到、檔頭缺欄位或值不合法、`status=dispatched` 的工單違反 R2 或 R3、
`touches` 對不到落點表。

### `touches` 怎麼對到落點

落點表是 `scripts/boundaries.owners.json` 的 `owners` 清單,一列 `[前綴, 落點]`。對每個 `touches` 項目:

1. 取**最長**的、是該項目前綴的表列,它的落點算進來;
2. 若該項目是目錄(以 `/` 結尾),**所有前綴落在該目錄底下的表列**的落點也算進來
   (`scripts/` 會涵蓋 `scripts/due.ts` 所屬的落點;這是保守的:寧可誤擋,不要漏擋);
3. 兩者都沒有 → `PROBLEM no-landing`。

一張工單的落點是它所有項目落點的聯集。R2 比兩張工單有沒有重疊,**分兩種比法**(顧問 2026-10-15 補):

- **落點不是 `infra` 的部分:用落點比對**——兩張工單的非 `infra` 落點有交集就重疊;落點是 `contracts` 的,和任何工作都互斥。
- **落點是 `infra` 的部分:改用檔案層級比對**——`infra` 是一個大桶(`scripts/` 底下大多數守門與工具都落在它),用落點比對會讓動不同檔案的兩張工單假性重疊。
  所以兩個落在 `infra` 的 `touches` 項目,**逐字相同,或其中一個是另一個的目錄前綴(以 `/` 結尾)**,才算重疊。
  不改落點表本身(拆開 `infra` 會改變 boundaries 的 import 規則:`scripts/` 底下互相 import 會變成跨落點違規,代價比收益大)。

兩張工單重疊 = 非 `infra` 落點有交集,**或**有一對 `infra` 項目按上面的規則重疊。
**新增檔還沒登記在落點表時**(例如即將新增的 `scripts/vault.ts`),要嘛 `touches` 寫它所在的目錄,
要嘛工單把「登記落點」列為第一步並先合併那一列;`dag:check` 不替沒登記的檔猜落點。

### 對規則的解讀(技術顧問 2026-10-15 逐條確認;第 4、6、7 條為顧問改過的版本;第 8 條為 2026-10-21 顧問補定)

1. **R5 的「深度」**:一條依賴鏈上**尚未滿足的節點數**(含自己),已 `done`/`merged`/有 tag 的不算——否則歷史會讓深度只增不減。
2. **R4 / R5 違反時只印 `WARN`,不讓 `dag:check` 紅**:顧問的紅燈清單裡沒有它們。
3. **R4 的 3 只數 `dispatched`,不數 `review`**:`review` 佔的是驗收者,不是 worker;驗收的吃 CPU 已由 R3 管。
4. **R2 比 `dispatched` 和 `review` 的工單**(顧問改):`review` 的工單常被退回去修(T2b 就是),退回的那一刻又會寫檔;
   如果 `review` 不佔落點,別的工單可能已經在同一塊開工,兩邊就撞了。**落點要佔到 `merged` 或 `dropped` 才放。**
   進行中的 phase 沒有 `touches`,不參與 R2。`dag:check` 紅的條件:一對在 {`dispatched`, `review`} 的工單落點相交,
   而且這一對裡**至少有一張是 `dispatched`**(推論:兩張都是 `review` 的,當初派工時若有相交,那時就已經紅過)。
5. **`dropped` 的工單永遠不算滿足**:依賴它的工單印 `BLOCKED … by <id> (dropped)`,由人決定改 deps 或復活。
6. **`START` 的選法**:`READY` 的工單依 id **自然排序**(`T2` 先於 `T10`),逐張檢查「對已在跑的 + 這輪已選的」是否違反 R2/R3/R4,不違反就 `START`,
   違反就 `HELD`。這只是一個固定、可重現的排序,**不是優先權**;優先權屬於協調者。
7. **沒有檔頭的工單檔**是 `PROBLEM missing-header`,`dag:check` 紅(顧問改)。
8. **`no-landing` 只查 `status` 不是 `merged` / `dropped` 的工單**(顧問 2026-10-21):已合併工單的 `touches` 是歷史,R2 不再用它,所以對不到落點表不出 `PROBLEM`、`dag:check` 不紅;`todo` / `dispatched` / `review` 的工單對不到落點仍然 `PROBLEM no-landing`。

## 步驟定義的約定(兩個 `.feature` 共用)

- 「ticket table」一列蓋出一個 `docs/tickets/<id>-example.md`,帶合法檔頭;表裡沒有的欄位用預設:
  `budget_usd: 1`、`owner: worker-grok`、`must_catch: []`。`deps`、`touches` 格子是逗號分隔,空格子是空清單。
- 「has a valid header except that "<field>" is "<value>"」的 `<value>` 是**冒號後面的原始 YAML 文字**
  (`T1` 是純量不是清單,所以 `deps` 不合法;`[T1]` 才合法)。
- 假樹的落點表是它自己的 `scripts/boundaries.owners.json`(`{ "owners": [[前綴, 落點], …] }`,與真檔同形)。
- Gherkin 的步驟文字**不做**反斜線解碼:步驟裡要比對含雙引號的行,用「an edge from … to …」「a task command for …」
  這類步驟,由步驟定義自己組出整行,不在步驟文字裡塞 `\"`。

## 驗收方式

- 自動:`phase-1.feature`、`phase-2.feature` 全部非 `@manual` 場景;步驟定義照 `features/steps/_world.ts`。
- phase-1 另外檢查:`npx tsx scripts/dag.ts --root <repo 根>` 在**真的** repo 上印得出 `gate=dag result=OK`,
  並把輸出的 `READY` / `BLOCKED` / `HUMAN` / `PROBLEM` 貼進驗收報告,由顧問核對「與你看 NEXT.md 的直覺一致嗎」。
- phase-2 另外檢查:`npm run dag:check` 在真的 repo 上綠(若紅,報告列出每一條,是工具錯還是樹真的有毛病);
  R5 在真樹上的實測值要寫進報告——接進 `check:all` 之前先知道它不會一接就紅。
- 變異:標準 80%,範圍是 `scripts/dag.ts` 內解析 NEXT.md、判定滿足、判定 R2/R3/R4/R5 的函式。
  **驗收必須證明測試抓得到的突變(`must_catch`)**:
  - 把「最長前綴」改成「第一個符合的前綴」→ 最長前綴場景必須紅;
  - 把 R3 的 `dispatched or review` 改成只數 `dispatched` → `review` 場景必須紅;
  - 把 `contracts` 落點的互斥拿掉 → contracts 場景必須紅;
  - 把「checklist 勾選狀態不讀」改成讀 → 勾了卻沒 done 的場景必須紅;
  - 把決策 gate 的 `HUMAN` 改成當作已滿足 → 三個決策 gate 場景必須紅;
  - 把「只讀」破壞(在 `--root` 底下寫一個檔)→ 不變動場景必須紅。
- 沒有 `@manual`。

## 開放問題

- **tag 的測試做法**:規格選「真的 `git tag`,步驟定義在暫存目錄 `git init` 後打 tag」,不加 `--tags` 這種測試專用旗標
  (測試專用的縫,正式路徑永遠不走)。代價是測試要起 git。(顧問未反對,實作時再確認。)
- **進行中的 phase 要不要參與 R2**:phase 沒有 `touches`;本規格選不參與(顧問同意)。
- **`--orca` 的 `<id 欄位>`**:phase-2 實作者開工前量,見上。
- **commit gate 要寫含字母的 sha**(全數字的短 sha 工具不認);要不要對齊 check-next-gates,phase-2 再決定。

已定案(不再是問題):fixture 放自己資料夾底下的例外(ADR-065 已記)、phase-1 暫不掛 `@standalone`、`touches` 對落點的規則、
受限 YAML、重複 id 算 PROBLEM、`owner` 加 `worker-codex`、`budget_usd: 0` 的條件、沒檔頭的工單算紅。
