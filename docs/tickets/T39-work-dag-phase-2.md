---
id: T39
deps: [13-work-dag/phase-1]
touches: [scripts/dag.ts, scripts/dag.test.ts, scripts/dag-check.ts, scripts/dag-check.test.ts, scripts/boundaries.owners.json, scripts/zero-input-roster.ts, scripts/gates.config.json, package.json, docs/tickets/, features/13-work-dag/FEATURE.md, features/13-work-dag/NEXT.md]
cpu: heavy
budget_usd: 6
status: todo
owner: worker-grok
must_catch:
  - 把 R2 的「最長前綴」改成「第一個符合的前綴」:最長前綴場景必須紅
  - 把 R3 的「dispatched 或 review」改成只數 dispatched:review 場景必須紅
  - 把 contracts 落點的互斥拿掉:contracts 場景必須紅
  - 兩個落在 infra 的 touches 項目改用落點比對(不用檔案層級比對):動不同檔的兩張 infra 工單被誤判相交的場景必須紅;逐字相同或目錄前綴的場景必須仍然相交
  - review 狀態的工單不佔落點(只數 dispatched):R2 的 review 場景必須紅;兩張都是 review 的相交對不算紅
  - dropped 的工單被當成滿足:依賴它的工單必須印 BLOCKED by <id> (dropped),不得 READY
  - R4 / R5 違反讓 dag:check 變紅(顧問裁決只印 WARN):WARN 場景必須紅;R5 深度把已 done/merged/有 tag 的節點算進去也必須紅
  - 已 merged / dropped 的工單,touches 對不到落點:不得出 PROBLEM no-landing、不得讓 dag:check 紅(解讀 8);todo / dispatched / review 的工單對不到落點必須仍然紅
  - 沒有檔頭的工單檔、欄位缺漏或值不合法(cpu: medium、status: wip、owner 不在清單、budget_usd 不是非負數、deps 不是清單、budget_usd 0 配 todo)沒被抓成 PROBLEM / 紅燈
  - touches 對不到落點表時猜一個落點:必須 PROBLEM no-landing 並讓 dag:check 紅
  - START 的選法用字串排序(T10 排在 T2 前面)或把順序當成優先權:自然排序場景必須紅
  - 工具寫任何檔:執行前後樹逐位元組相同的場景必須紅(phase-1 的只讀性質不得退步)
  - dag:check 沒接進 scripts/gates.config.json 的 chain,或接了但故意弄壞輸入時不紅:接上之前必須先證明它會紅一次,證據寫進報告
  - 新增檔沒登記 scripts/boundaries.owners.json 與 scripts/zero-input-roster.ts:npm run boundaries 與 zero-input-guard 必須紅
  - 任何 .feature、contracts/、scripts/check-next-gates.ts(模板擁有)被改:不退步必須紅
---

# 工單 T39:13-work-dag phase-2 —— 工單進圖、平行規則 R1–R5、`--orca`、`dag:check` 接進 `check:all`

> 狀態:草稿 2026-10-21,待顧問審。協調者起草。紅測試:-5c(步驟定義與單元測試)。實作:worker-grok(opencode grok-4.7)。驗收:-84(含變異,標準級 80%)。
> 這份檔是工單唯一的正本;驗收條件只在這裡寫一次,不經過轉述。
> 規格正本:[features/13-work-dag/FEATURE.md](../../features/13-work-dag/FEATURE.md)(工單檔頭格式、R1–R5、`touches` 對落點、七條解讀、輸出形狀)與
> [features/13-work-dag/phase-2.feature](../../features/13-work-dag/phase-2.feature)(行為)。本工單**不複述規格**,只寫分工、檔案、驗收與不在範圍。
> 決策:ADR-065(accepted 2026-10-15)。
> 基底:main(`b123049` 或之後)。

## 為什麼有這張

phase-1 的 `scripts/dag.ts` 只算 phase 之間的 ready / 卡住 / 待人判。協調者排工單時仍靠記憶判斷「這張能不能和那張同時跑」(落點相不相交、重活是不是已有一個、WIP 超沒超),
而且忘了檔頭、deps 寫錯這類毛病沒有人會抓。phase-2 把工單檔頭納入圖,把 R1–R5 變成會印 `START` / `HELD` 的規則,
再把會讓圖壞掉的情況做成 `npm run dag:check` 的紅燈,接進 `check:all`。

## 分工

- **-5c(測試,先做)**:`phase-2.feature` 的步驟定義(照 `features/steps/_world.ts` 的結構)、`scripts/dag.test.ts` 的 phase-2 單元測試、`scripts/dag-check.test.ts`;
  不寫 gherkin、不碰實作。必要時用 fixture 放在 `features/13-work-dag/fixtures/`。
- **worker(實作,只改實作)**:`scripts/dag.ts` 擴充、新增 `scripts/dag-check.ts`(`dag:check` 入口;也可併入 `dag.ts` 加 `--check`,由實作者依測試決定並在報告說明)、
  登記落點與名冊、接進 chain、依證據修舊工單檔頭的 `status`。**不改任何 `*.test.ts`、步驟定義、`.feature`**(受保護的測試檔);覺得測試有錯寫進報告「待協調」。
- **-84(驗收)**:非作者驗證、`npm run mutate`(範圍:`scripts/dag.ts` 內解析檔頭、判定滿足、判定 R2/R3/R4/R5、`touches` 對落點的函式,以及 `dag-check.ts`)、核對 `must_catch`。

## worker 要做的事(順序)

1. **`--orca` 的 `<id 欄位>` 已由協調者量好**(2026-10-21,用一個丟棄用的 task,量完已設成 failed):`orca orchestration task-create ... --json` 的回傳是
   `{ "id": …, "ok": true, "result": { "task": { "id": "task_…", … }, "mutation": { "requestId": … } } }`,所以任務 id 的 jq 路徑是 **`.result.task.id`**
   (注意:最外層的 `.id` 是請求 id,不是任務 id;`task-list --json` 的形狀不同,是 `.result.tasks[].id`)。
   `--orca` 印的那行是 `T1=$(orca orchestration task-create --spec "$(cat docs/tickets/T1-….md)" --deps "[]" --json | jq -r '.result.task.id')`。worker 照這個寫,不要自己猜,也不要自己去建 task。
2. **先登記落點**(真 `scripts/boundaries.owners.json` 目前沒有 `docs/`、沒有 `scripts/` 與根目錄設定檔的總列,也沒有 `features/<NN-name>/` 的列;本工單自己的 `touches` 與 7 張舊工單會 `PROBLEM no-landing`)。加這些列,再 `npm run boundaries`:
   - 根目錄與 `scripts/` 底下的設定檔(`package.json`、`standalone.json`、`scripts/gates.config.json`、`scripts/boundaries.owners.json`、`scripts/boundaries.allow.json`)→ `infra`(`infra` 用檔案層級比對,不會假性互擋);
   - `features/<NN-name>/`(14 個資料夾一次登記完)→ 該 NN 的落點;`features/steps/`、`features/support/` 是更長的前綴,仍歸 `steps`;
   - `docs/` → `docs`(與假樹的 Background 一致)。若 `scripts/check-boundaries.ts` 不認新的落點名 `docs`,改用 `infra` 並在報告寫明。
   這一步動到設定 JSON,所以 `check:test-ledger` 要整套跑(owners 的條數或內容可能被測試釘住:`git grep` 找釘它的測試,列在報告)。
   新增的 `scripts/dag-check.ts`、`scripts/dag-check.test.ts` 同一步登記進 `scripts/boundaries.owners.json`(→ `13-work-dag`)與 `scripts/zero-input-roster.ts`。
3. 實作 phase-2:工單進圖(讀 `docs/tickets/*.md` 檔頭,受限 YAML 子集,自己解析,不 import 套件)、`READY` / `START` / `HELD`、R2–R5、`--orca`、各種 `PROBLEM`。
4. **對照真樹**:`npm run dag:check` 在真 repo 上跑,逐條列出紅的原因,分「工具錯」與「樹真的有毛病」。
   樹真的有毛病的,**只准做兩件事,都限於 `docs/tickets/*.md` 的檔頭**:
   (a)改 `status`(依 git 證據;例如 T37 已合併卻寫 `todo`、T24 的 `status: ready` 不是合法值,也依證據改);(b)替沒有檔頭的檔補檔頭。
   **不准為了讓它變綠去改 `deps`、`touches`、`cpu`、`owner`**:遇到這種,寫進報告「待協調」。**T39 自己的檔頭不准動。不改工單內文,不改任何別的檔。**
   報告每一筆列「檔、舊值、新值、依據(合併 commit 的 sha)」;-84 逐筆對 git 核。
5. 量 R5 在真樹上的深度,寫進報告(接進 `check:all` 前要知道它不會一接就紅;R4/R5 只印 `WARN`)。
6. **先證明會紅,才接進 chain**:把 `dag:check` 加進 `scripts/gates.config.json` 的 `chain` 之前,先故意弄壞輸入(缺檔頭的工單、有環、`dispatched` 違反 R2),證明它退出碼非 0;
   還原後才接。報告貼三次紅、一次綠的原始輸出。`package.json` 加 `dag:check` 這個 npm script(chain 裡的每一條都要是 npm script)。
7. `features/13-work-dag/FEATURE.md` 的 phase 表與 `NEXT.md` **只在驗收通過後由協調者做**——worker 不要改這兩個檔(上面 touches 列出它們是為了讓 R2 把它們算進這張工單的落點)。

## 驗收(-84 照做)

- **phase-2 不加 `@standalone`、不改 `standalone.json`**(`13-work-dag` 的鍵 phase-1 已有;再補會變重複鍵;`phase-2.feature` 不帶 `@standalone`,而工單禁止改 `.feature`)。
- 受保護的測試檔比對:`git diff --name-only <基底>..HEAD`,測試檔只能來自 -5c 的 commit。
- `npx cucumber-js --tags "@work-dag and @phase-2"`(只用 `--tags`,不要給 feature 檔名);`@phase-1` 一起跑,phase-1 不得退步。
- `npm run boundaries`、`npx tsc --noEmit`、`npx tsx scripts/check-doc-links.ts`、`npx vitest run scripts/zero-input-guard.test.ts`、整個 vitest(含 `check:test-ledger`)。
- **`scripts/gates.config.json` 是設定 JSON,這張動到它,不算只動文件**:`check:test-ledger` 完整跑,並 `git grep` 釘住 chain 長度的測試與文件(`scanned=20` 之類的字面,例如 `docs/phase-status-cost-baseline.md`、`docs/reviews/date-dependent-lock-tests.md`),
  接進 chain 後 `scanned=` 會變成 21:逐處判斷那句話在新行為下還成立嗎,不成立的在報告列給協調者(不要自己改 `docs/reviews/` 底下的歷史證據)。
- 真 repo:`npx tsx scripts/dag.ts --root .` 印得出 `gate=dag result=OK`;`npm run dag:check` 在真 repo 綠;報告貼 `READY` / `START` / `HELD` / `WARN` 的真輸出,由顧問核對「與你看 NEXT.md 的直覺一致嗎」。
- 變異:標準 80%,範圍如上;附完整指令(`npm run mutate -- <設定檔>` 與範圍、旗標)。
- 前後各量一次 `learning/`(唯一量法),三個數字必須相同。

## 不在範圍

- 不改 `contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`scripts/check-next-gates.ts`(模板擁有)。
- 不改任何 `.feature`(規格是顧問審過的)。
- 不把 `--orca` 的輸出接到派工流程(屬於協調者的 SKILL.md,不是這裡)。
- R4 / R5 違反**只印 `WARN`**,不讓 `dag:check` 紅(顧問裁決)。
- 不重新評估 R5 規則本身;若真樹實測常態逼近 4,寫進報告交顧問,後續 ADR-065 再議。
- 不替沒登記的新檔猜落點(`dag:check` 紅是設計)。

## 後勤(給協調者)

- 派工提示要列受保護的測試檔(`*.test.ts`、`features/steps/**`、fixtures、`.feature`);worker 的起點分支由協調者組(origin/main + -5c 的紅分支)。
- 這張要動 chain 長度,合併後整鏈(含 `check:test-ledger`)與 `env -u TEMPLATE_DIR npm run check:gates` 都要跑;`dag:check` 接進去之後,**往後每張新工單的檔頭缺漏都會讓整鏈紅**,所以顧問審過、T39 合併後,協調者把這兩件事寫進 SKILL.md:新工單必須有檔頭;檔頭 `status` 要維護——派工 → `dispatched`、交驗收 → `review`、合併 → `merged`、放棄 → `dropped`,每次跟著那一批的 main commit 一起改,不單獨推(不維護的話 R2 / R3 永遠不會紅、`START` 會把在跑的工單再列一次,`dag:check` 等於空守門)。
- 重活:worker 自己只跑單檔 vitest 與 `--tags` 的 cucumber(要先向協調者要位子,回「要位子」);變異屬 -84。
