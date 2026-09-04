---
name: autopilot
description: 讓協調者不停推進專案,把使用者當成只要成果的老闆。當使用者說「一直做」「自動推進」「不用問我」「autopilot」,或協調者在 /loop 裡被喚醒時使用。內含決策權責表(哪些自己決、哪些問技術顧問、哪些才問使用者)、每輪的固定流程、沒事可做時的維護清單、煞車條件。只給協調者用;技術顧問與 worker 不跑這個。
---

# /autopilot — 協調者的自動推進迴圈

啟動方式:協調者 session 執行 `/loop 15m /autopilot`。每次醒來跑一輪下面的流程,回報一段,然後睡。
**使用者是只要成果的老闆**:不問他技術問題,只在「權責表」寫明的三種情況才找他,而且找他時要把選項與建議一起給,讓他一句話能答。

## 0. 每輪開頭(固定,不可省)

```bash
cd <repo 根目錄> && pwd && git branch --show-current   # P-19:確認在根、在 main
git status --short --untracked-files=no | head          # 根目錄不該有「已追蹤檔案」的未 commit 變更;未追蹤的產出目錄不算
npx tsx scripts/llm-spend.ts --today                   # 今日 OpenAI 花費;退出碼 0 未達 / 1 已達上限(≥ 就算)/ **2 算不出來**
                                                       # 2(log 缺、上限變數缺、有壞行)→ 停所有 @llm 工作 + 開工單 + 通知技術顧問;「不知道」不是「零」
                                                       # 檔案還不存在(03/phase-4 未合併)→ 跳過這步,不當煞車
grep -o "ADR-0[0-9]*" docs/02-decision-map.md | sort -u | tail -1   # 目前最大 ADR 號;派工說明裡寫「ADR-下一號 = 這個+1」,worker 不自己猜
```
讀 `docs/01-roadmap.md` 現況表、所有 `features/*/NEXT.md`、`docs/sprints/<本週>.md`。

## 1. 權責表(誰決定什麼)

| 情況 | 誰決定 | 怎麼做 |
|---|---|---|
| 派工順序、合併順序、worktree、審核回合 | **協調者自己** | 直接做 |
| 技術取捨:資料結構、介面形狀、規格措辭、gate 例外、要不要重跑、變異存活怎麼分類 | **技術顧問**(**session 名見 `CLAUDE.md` 的「做決定時」** —— 那裡是唯一權威。名字會變,這裡不重複寫,免得兩處不同步) | SendMessage 問,附你的傾向;**30 分鐘沒回就照保守選項做**,記 ADR 標「待覆核」,下一輪再提 |
| 新功能、新需求、改「不在範圍」 | **使用者** | `/feature` 分流出提案,放進「等老闆」清單,**不擋其他工作** |
| 改 `contracts/` 硬約定、改 `CLAUDE.md` | **使用者** | 同上,附 ADR 草稿 |
| 花錢超過當日上限(`LLM_DAILY_CAP_USD`) | **使用者** | 不跑;@llm 場景延到明天或等他加碼 |
| 人眼確認(`@manual`、`@e2e`) | **使用者** | 列清單(場景原文 + 檔案路徑),放「等老闆」清單 |

判斷「新功能」的標準用 feature-triage 的 E / C / B 三種 → 使用者;A / D → 技術顧問。

## 2. 每輪流程

1. **收割**:哪些 worktree 的審核回來了 → PASS 的合併(一次一個,`git checkout main && git merge --no-ff <branch>`,**不 rebase**,每個 phase 三輪 commit 的軌跡是刻意留的),合併後跑完整檢查:
   ```bash
   npm run boundaries && npm run typecheck && npm run lint:docs && npm test && npm run accept:standalone && npm run standalone
   npm run accept:dry        # 必看「0 ambiguous」:步驟定義撞名不會讓任何測試變紅,只有這步抓得到
   npm run check:steps       # 每句 gherkin 恰好一個步驟定義
   npm run check:gherkin-dup # 重複的 gherkin 場景;**必跑且必須 exit 0**,不准靠放寬規則變綠
   npm run accept:coverage   # 每個 phase-N.feature 用自己的 tag 至少比對到 1 個場景;tag 打錯字只有這步抓得到
   npm run check:gates       # 守門漂移偵測:scripts/ 的守門與同步當時的 sha256 不符就紅。
                             # 目前同步到 **v1.3.4**,沒有任何已知例外——**任何一行紅都是真的漂移**。
                             # 設定檔(boundaries.owners.json / boundaries.allow.json / gates.config.json)
                             # 印「○ 你的設定檔,不比對」,那是對的。
                             # 模板路徑吃 $TEMPLATE_DIR,沒設就用預設的模板 worktree。
   ```

   ⚠️ **這條在 2026-09-05 之前只是 SKILL.md 裡一行手打指令,沒有進 `package.json`** ——
   也就是「清單上寫著、實際沒人跑」。技術顧問抓到後才補成 `npm run check:gates`。
   **清單裡的每一條都要是 npm script**,否則它就只是一句話。
   **合併後留一份 junit,下次比「名稱集合」不比「總數」**:
   ```bash
   npx vitest run --reporter=junit --outputFile="reports/junit/$(git rev-parse --short HEAD).xml"
   ```
   下次合併時對 testcase 的**名稱**做 diff,**不要看數字** ——
   別的專案抓到過「總數相等但組成不同」(branch 8044 = 8036+4+4、main 8044 = 8036+8):
   **數字對得上,內容少了四條。**

   ⚠️ **比的時候要用 multiset 或完整限定名(檔案 + suite + name),不要用 `set(names)`** ——
   本 repo 實測 1691 個 testcase 只有 **1683 個不重複名稱**(8 個同名),
   用集合比會**憑空少掉 8 筆**,那本身就是一個「看起來乾淨」的假象。

   **合併後跑的是 main 現在的完整檢查清單,不是分支開工時的那份。** 分支 base 比 main 舊的時候,
   main 上可能已經多了新的守門 —— 那些**在分支上根本不存在**,所以「分支全綠」不等於「合併後全綠」,
   而**新加的守門正好是最容易漏的那些**(它們是為了抓新問題才加的)。
   實例:golden-set 那張的 base 早於守門合併,審核主動提醒「`check:steps` 與 `accept:coverage`
   在這個 branch 上不存在,合併後要補跑」。

   全綠 → **tag 打在合併 commit 上**(不是之後的文件修正 —— tag 的意思是「**這個合併**通過」)
   → 清 worktree → **立刻**通知技術顧問「驗推」。

   ⚠️ **合併完就通知,不要累積**(P-56)。真的發生過:協調者 03:16 合併、又做了兩個 commit、
   再合一條才通知;技術顧問 03:17 在上面 commit 然後 push —— **那個合併在他驗之前就被推上去了**,
   因為 **`git push` 推的是 HEAD 以下全部,不是「我剛 commit 的那一個」**。
   規則:**一輪只合一條就通知一次**,或合併後立刻通知。中間不要再往 main 疊東西。

   FAIL 的照 test→dev→review 循環派 debug session。
2. **算 ready**:照 sprint-planning 的規則讀所有 NEXT.md。三種 gate 全滿足 → ready。
3. **派工**:ready 的全部派出去,直到同時進行的 worktree 達上限(**3**)。滿載時不派新工,回到 1 收割;收割不到東西就做維護清單(§3)等下一輪。~~同時處於審核輪的 worktree ≤ 1~~ **已放寬回 3**(2026-09-04):`scripts/mutate.ts` 的跨 worktree 檔案鎖合併後,變異測試會自己排隊,不再需要靠派工節流(P-34)。**`npm run mutate` 是唯一入口**,審核與開發都只准用它 —— 直接叫 Stryker CLI 會繞過鎖(`scripts/mutate.test.ts` §13 掃 repo 裡**所有文字檔**守著,程式碼註解也掃;2026-09-05 起,因為第一版只掃 md / json / sh 漏過 `vitest.mutate.config.ts` 裡一條可照抄的指令)。**分數要附完整指令**(設定檔、範圍、旗標),不附指令的分數不算數。每張照角色規則:測試 agent 先寫紅 commit → 開發 agent 做綠 → 審核 agent(REVIEW.md 交接)。
4. **整合點**:某個 IN 需要的 phase 全 done → **先開「整合工作」工單**(P-20:roadmap 該段的整合工作欄 + 各 FEATURE.md「Wave 0 的重複」表),合併後 `/integrate IN`;`@e2e @llm` 在預算內自動跑,結果貼進 `docs/integration/IN-REVIEW.md`;`@manual` 進「等老闆」清單。IN 的人工確認未完成前,gate 是「IN 通過」的 phase 維持 todo——這是刻意的,不要繞。
5. **沒有 ready 的 phase** → 做維護清單(§3),做完一項就回到 2。
6. **回報**(§5 格式),睡。

## 3. 維護清單(沒事可做時,由上往下)

**連續 3 輪沒被碰過的項目 → 升級成一張工單,不要再留在清單裡。**
「有空再做」等於不會做,而**沒被碰過的東西本身就是最可能藏東西的地方**:
`lint.ts` 的「空 vault 跟健康 vault 輸出一模一樣」就是這樣被發現的 ——
它不是被守門抓到的,是協調者終於做了自己一直跳過的第 3 項才撞見的。


1. `template/PITFALLS.md` 與 `docs/02-decision-map.md` 裡標「待覆核」「待辦」的項目(例如 `--deps-only` 入口)
2. 標準級模組變異分數 < 80% 的檔案(`reports/mutation/` 最近一次),補測試
3. `npm run lint:wiki` 對 `learning/` 的健檢結果,能自動修的修
4. 文件漂移:roadmap 現況表、features/README.md 索引、各 FEATURE.md phase 表三者對不上的地方
5. `npm audit` 的高風險項
6. 以上都空 → **停止迴圈**(`ScheduleWakeup stop`),寫本週 sprint 檔,把「等老闆」清單整理成一則訊息給使用者

## 4. 煞車(任一成立就停下該項,其他繼續)

- 同一張工單連續 **3** 輪 FAIL → 該 phase 標 `blocked`,原因寫 NEXT.md,問技術顧問
- 當日 OpenAI 花費達上限 → 所有 @llm 工作停,非 LLM 工作繼續
- 完整檢查在 main 上紅 → **先修 main**,不派新工
- 根目錄有**已追蹤檔案**的未 commit 變更,或不在 main → 停,查是誰(P-12 / P-19);未追蹤目錄(例如產出資料)不觸發,但要確認它在 .gitignore 裡
- 技術顧問 session 不在(`ListAgents` 找不到)→ 技術決策改成「保守選項 + ADR 待覆核」,不問使用者
- 同時進行的 worktree 已達 3 → 不派新工,先收割
- ~~已有一個審核輪在跑變異測試 → 其他先等~~ **由檔案鎖取代**(P-34)。仍然成立的:agent 看到 stryker 退出碼 137 / 144 一律**重跑**,**絕不把當次結果當分數**。

## 4a. 什麼**不是**停止條件(容易誤判成停止的狀況)

煞車(§4)是「停下某一項」,下面這些**看起來像壞掉,但不是**:

- **Orca runtime 掛掉 / `runtime_unavailable` / `runtime_timeout`**
  → **不是**。worktree 與 commit 都在磁碟上,agent 程序也還活著(`pgrep -af claude` 看得到)。
  掛的只是orchestration API。**先用 git 確認各 worktree 的 commit 與未提交變更沒事**,
  然後做不需要 Orca 的事(文件、skill、自己跑檢查),等它回來。**不要重派工單** ——
  重派會變成同一份工作跑兩份。
- **worker 開 escalation / question**
  → **不是**。那是流程在運作。worker 停下來問,比它猜一個答案往下做便宜得多。
- **worker 說「我不照工單做」並附實測**
  → **不是**,而且通常是那一輪最有價值的事。驗證它的實測,對了就改工單。
- **工單被 superseded / 方向改了三次**
  → **不是**。開新工單、舊的標 superseded 並寫下理由鏈就好。
- **變異分數第一次量到很低(40–60%)**
  → **不是**。那是「第一次真的量」,不是退步。照四分類處理。
- **`accept:dry` 的 undefined 場景數很多**
  → **不是**,那些是未來 phase 的既有狀態。**要看的是 `ambiguous` 是不是 0。**

- **一條「不存在於 main 的紅」**
  → **先確認那個紅是不是你量出來的。** `rtk` 的輸出層會把**同時在跑測試的別的 worktree** 的結果混進來 ——
  技術顧問的驗證 agent 就兩次看到 `zero-input-guard.test.ts` 的紅,而那個檔**根本不在 main 上**。
  **規則:驗證數字有任何一行對不上,先 `rtk proxy <cmd>` 或裸 `npx vitest run` 重跑一次再下判斷。**
  這是「**這個紅是量出來的,還是探針壞了**」的又一例 —— 跟 `| tail` 吃掉退出碼同族。

真正該停的只有 §4 那幾條。**把上面這些誤判成停止,比漏掉一個真煞車更常發生。**

## 4c. 「分支上全綠、合併後紅」的兩種形狀(P-49)

分支全綠**不等於**合併後全綠。除了「main 多了分支沒有的守門」(§2.1),還有兩種**測試自身**的形狀:

1. **測試把「一定在 worktree 裡跑」內建成假設** → 到 main 就**永遠紅**。
   實例:`expect(seen).not.toBe(join(REPO_ROOT, '.stryker.lock'))` —— 在 worktree 裡兩者不同所以綠,
   在主 repo 裡兩者本來就相同所以紅。**涉及路徑的斷言要在 worktree 與 main 兩種位置各跑一次。**
2. **main 上有分支看不到的檔案被規則掃到** —— 別的 repo 的簽出(`.claude/worktrees/`)、
   協調者自己寫的文件(它可能為了**描述**一個錯誤而引用那個錯誤的字串)。
   **掃描類測試的 SKIP 清單要含 `.claude/worktrees`。**

**協調者為了修 main 紅燈而動測試檔**:可以先修(§4「先修 main」優先),但**同一輪必須開一張 review 工單事後覆核**,
工單裡逐處列出「為什麼是測試錯不是實作錯」。覆核者判定任一處其實是**放寬** → **退回**。

## 4b. 平台操作備忘(Orca,實際踩過的)

- `worker-start --worktree new-top-level` **一定要帶 `--name`**,不帶會 `invalid_argument`
- `worker-start` 只用在一個 worktree 的**第一輪**。同一 worktree 的第二、三輪(debug / 再審):
  `terminal create` → `terminal send 'claude --dangerously-skip-permissions' --enter` → `terminal wait --for tui-idle` → `dispatch --inject`。
  少中間兩步會 `no recognized agent detected`;重用舊終端機常 `agent_unconfigured`。**永遠開新終端機**,交接靠 worktree 裡的 REVIEW.md(P-17)
- **worker 用 `orchestration ask` 阻塞時,只能用 `orchestration reply --id <msg_id>` 解,`send` 不行**(P-45)。
  `send` 送得到那個終端機,但**不會解除 `ask` 的阻塞** —— worker 等到逾時後自己走保守選項,
  而協調者以為自己回了。**兩邊都以為溝通成功,而且沒有任何錯誤訊息。**
  判斷:`check` 回來的 message `type` 是 `question` → 用 `reply`;其他才用 `send`。
  **順序也重要:先 `reply` 再 `ack`** —— ack 之後 `check` 就抓不到那個 msg_id 了,只能退而用 `send`(就是踩坑的那次)。
- `check --wait` 可能回**已處理過的舊訊息**(`"replayed": true`),要 `--ack <deliveryId>` 再等下一則,不然空轉
- 開 worktree 明確指定起點(`--base-branch main` 或 `git worktree add -b <branch> <path> main`),開完驗 `git merge-base --is-ancestor main <branch>`(P-18)

## 5. 每輪回報格式(給使用者看的,越短越好)

```
[autopilot 第 N 輪 · 今日花費 $x.xx / 1.00]
合併:04/phase-3 ✓、05/phase-2 ✓
進行中:03/phase-4(審核)、12/phase-2(開發)
等老闆:I1 @manual 兩條(learning/cards/security/sec-0001..0003.md)
決定了(ADR):039 閘道本機模型 — 待覆核 0
卡住:無
```

## 6. 不做的事

- 不 push(技術顧問推)
- 不改 `CLAUDE.md`、`contracts/` 硬約定、`prompts/`(改 prompt 要 golden run,那是 12 的流程)
- 不在根目錄 checkout 別的分支
- 不因為「等老闆」而停下其他能做的事;也不因為想推進而繞過「IN 通過」的 gate
