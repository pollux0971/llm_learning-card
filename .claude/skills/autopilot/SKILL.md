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
grep -oE '^#+ *ADR-[0-9]+' docs/02-decision-map.md | grep -oE '[0-9]+' | sort -n | tail -1   # 把這條指令原樣寫進工單,worker 在寫入當下取號
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
   npm run check:all         # 這一行就是全部。最後印 `gate=all result=PASS scanned=<實際>`。
   ```

   ⚠️ **不要再手打那份清單。** 這裡原本列了 11 條手打指令,**少三個 gate**
   (`doc-rot`、`next-gates`、`phase-status`)。2026-09-12 協調者照那份跑完回報「全鏈綠」,
   技術顧問用 `check:all` 一跑是當時設定的完整步數 —— 結論剛好一樣,但**那是運氣,不是驗證**。
   **手打的清單一定會跟 `package.json` 漂開**,而漂開的方向永遠是「少跑」。
   `scanned=<實際>` 那個數字自己會長,清單不會。

   目前 `scanned=N` 是 chain 長度,不是這次真的跑了幾步；`ran=` 已提案上游,尚未生效。
   排序原則見 `docs/02-decision-map.md` 的 ADR-052 第 2 點(唯一真相;不另放一份,兩份會漂)。

   ⚠️ **這條在 2026-09-05 之前只是 SKILL.md 裡一行手打指令,沒有進 `package.json`** ——
   也就是「清單上寫著、實際沒人跑」。技術顧問抓到後才補成 `npm run check:gates`。
   **清單裡的每一條都要是 npm script**,否則它就只是一句話。
   **下一階更難看見:清單上寫著、跑了、但它不會紅。**
   實例(2026-09-12,顧問實測):`accept:dry` 印得出 `16 ambiguous` 卻**回 exit 0**,
   加 `--strict` 也一樣;於是 `check:all` 當時的鏈全綠、同時可以有 16 個場景是 ambiguous 的。
   「必看 0 ambiguous」這句在**人讀輸出**的年代有效,進了自動鏈之後**沒有人讀那一行**。
   **規則:任何守門接進鏈之前,先故意弄壞輸入讓它紅一次;沒紅過的守門不算接上。**
   **合併後留一份 junit,下次比「名稱集合」不比「總數」**:
   ```bash
   npx vitest run --reporter=junit --outputFile="reports/junit/$(git rev-parse --short HEAD).xml"
   ```
   下次合併時對 testcase 的**名稱**做 diff,**不要看數字** ——
   別的專案抓到過「總數相等但組成不同」(branch 8044 = 8036+4+4、main 8044 = 8036+8):
   **數字對得上,內容少了四條。**

   ⚠️ **比的時候要用 multiset 或完整限定名(檔案 + suite + name),不要用 `set(names)`**。
   用完整限定名(`classname` + `name`)比,同名那件事就不存在了(實測 3143 筆全部唯一；只用
   `name` 的量法得到的 9 組同名,正是限定名修正後消失的產物)。
   仍然用 multiset 而不是 set,是為了抓**改名偽裝成刪除**:一條測試被改名,set 比對會
   同時看到「少一個舊名、多一個新名」而算平手,multiset 才看得出組成變了。
   **理由過期比狀態過期更難察覺,因為沒有人會去重驗一個理由。**

   **不要記那個數字,它會腐爛** —— 要用就當場量。輸出同時列出只用 `name` 的同名組數、
   以及用完整限定名的同名組數,下一個人一跑就看得到差別:
   ```bash
   python3 -c "
   import sys,xml.etree.ElementTree as ET; from collections import Counter
   by_name=Counter(); by_full=Counter()
   for tc in ET.parse(sys.argv[1]).getroot().iter('testcase'):
       name=tc.get('name',''); by_name[name]+=1
       by_full[f\"{tc.get('classname','')}::{name}\"]+=1
   print('只用 name 的同名組數',sum(v>1 for v in by_name.values()))
   print('完整限定名的同名組數',sum(v>1 for v in by_full.values()))
   for k,v in by_full.items():
       if v>1: print(f'   x{v}  {k[:70]}')
   " reports/junit/<sha>.xml
   ```

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

   **後半條(2026-09-05 補):送出「請驗推」之後,main 凍結,直到對方回「已推」或「退回」。**
   凍結範圍是**整個 main,包含 `.claude/skills/` 這種看起來無害的檔案** —— 技術顧問是在
   **隔離的 detach 簽出**上驗那個 commit,你在 main 上疊東西他不會看到,但**下次 `git log` 對不起來**,
   而對不起來的第一反應是「他驗的東西被動過了」。實際代價:一次幻紅 + 20 分鐘。
   凍結期間有事做:派工、開工單、回訊息、在 worktree 裡工作 —— 那些都不動 main。

   FAIL 的照 test→dev→review 循環派 debug session。
2. **算 ready**:照 sprint-planning 的規則讀所有 NEXT.md。三種 gate 全滿足 → ready。
3. **派工**:ready 的全部派出去,直到同時進行的 worktree 達上限(**3**)。滿載時不派新工,回到 1 收割;收割不到東西就做維護清單(§3)等下一輪。~~同時處於審核輪的 worktree ≤ 1~~ **已放寬回 3**(2026-09-04):`scripts/mutate.ts` 的跨 worktree 檔案鎖合併後,變異測試會自己排隊,不再需要靠派工節流(P-34)。**`npm run mutate` 是唯一入口**,審核與開發都只准用它 —— 直接叫 Stryker CLI 會繞過鎖(`scripts/mutate.test.ts` §13 掃 repo 裡**所有文字檔**守著,程式碼註解也掃;2026-09-05 起,因為第一版只掃 md / json / sh 漏過 `vitest.mutate.config.ts` 裡一條可照抄的指令)。**分數要附完整指令**(設定檔、範圍、旗標),不附指令的分數不算數。**正確的輸出從來不會被稽核**：一個對的答案被錯的方法算出來時,沒有任何訊號會響；而指令是唯一還會露餡的東西。**每張照角色規則:測試 agent 先寫紅 commit → 開發 agent 做綠 → 審核 agent(REVIEW.md 交接)。
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

**可執行版本:**新規則落地的那個 commit / 工單,寫完之後把自己剛寫的東西當成別人的產出讀一遍,
只問一個問題——「這份東西違反了它自己剛立的規則嗎？」一條規則寫下來的當下,寫的人是最不
容易套用它的人,因為他正在**描述**它,不是在**用**它。

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

- **管線工具會安靜地吃掉東西,而被吃掉的部分不會抗議**
  → **`| head -N` 之前先看 `| wc -l`。命中數大於視窗就是「截斷」,不是「就這些」。**

  | 吃掉什麼 | 症狀 | 實例(都是 2026-09-13 同一晚) |
  |---|---|---|
  | `\| tail` / `\| head` 吃**退出碼** | `$?` 是管線最後一段的,不是你的指令的 | 我用 `cmd \| tail -5; echo rc=$?` 讀到 `rc=0`,而那是 `tail` 的 |
  | `\| head -N` 吃**清單長度** | 你照著截斷的清單報數 | 我數 stryker 設定報「10 個」,**實際 14 個** |
  | `\| head -N` 吃**決定性的那一筆** | 你據此結論「不存在」 | 鄰居專案:`grep \| head -8`,總命中 15 筆,**關鍵在第 9 筆** → 結論「那條線不存在」→ **叫使用者停止測試** |

  ⚠️ **第三個的代價最高,而三個的機制完全一樣。** 鄰居那次是在使用者親手驗收的當下叫他停的。

  **要退出碼就用 `${PIPESTATUS[0]}`,或先寫檔再讀。要清單就先 `wc -l`。**

  **為什麼沒有人會發現:被吃掉的部分不會抗議。**
  跟「**『比對不再發生』跟『比對通過』在輸出上完全一樣**」是同一句話 ——
  **缺席沒有表徵。**

- **看到別人的坑(別的專案回饋、別的 repo 的 PITFALLS)**
  → **不是**要立刻加防線。**先量自己中不中;加防線之前先查一個設定值。**
  實例:`nightmare-assault` 回饋「跑全套期間突變體會被 `git add -A` commit 進歷史」——
  我們 13 個 Stryker 設定 `inPlace` 全部未設定(預設 false = 沙箱),**查那個設定值花 30 秒,結論是不中**。
  他們當天跳過這一步直接加防線,**弄紅六個既有測試才 revert**。
  (回饋之後他們把標題收窄成「**就地改檔的突變工具**」,並在條目開頭加了「先查一個設定值,再決定要不要防」。)

- **看到別人的「解法」(不是坑,是他們已經做好的修法)**
  → **不是**照抄就好。**先問:那個解法的「安全的錯誤方向」在你這裡是不是同一邊?**
  **「安全的錯誤方向要從『錯了會怎樣』重新推一次,不能繼承。」**
  實例(2026-09-05,`nightmare-assault` 工人抓到的,對象是**我給的規則**):
  我那條「**子字串 pattern 一律當全套**」是為「**要不要搶鎖**」設計的 —— 錯要錯向「**多鎖**」,
  代價只是多等幾分鐘。他們原樣抄去用在「**指標讀哪一份紀錄**」,
  那裡把小跑當全套 = **指標讀到子集 = 指標說謊**,而且「只准降」剛好放行。
  **同一條規則,同一個推導,兩個用途,安全的方向剛好相反。**
  他們的工人原話:「**我搬了你的結論,沒搬你的前提。**」
  這條是「先量自己中不中」的**反向版**:那條管「別人的坑」,這條管「別人的解法」。

- **看到別的 repo / worktree 有未提交的東西,不敢動**
  → **不敢動是對的,但要用對的理由。查三樣再下判斷:`git status`(有什麼)、
  **那批檔的 mtime**(那批多舊)、**`git log -1`**(repo 本身多活),然後 `ListAgents` 找歸屬。
  實例(2026-09-12,同一件事我用兩個不同的錯理由連走兩遍):
  1. `/data/python/dev-paradigm` 有 17 個未提交檔,我推論「我沒動過 → 一定是技術顧問的」。
     **那是用排除法指認負責人。** 顧問說不是他的。
  2. 顧問給的更正是「那批 mtime 全是四天前,四天沒動的工作區更可能是**沒有人**在顧」。
     我去量,mtime 確實是四天前 —— **但那個 repo 的最後一個 commit 是當天 10:57**,
     `ListAgents` 也看得到兩個 `dev-paradigm-*` session 在線。
     **活躍 repo 裡的陳年殘留 ≠ 廢棄工作區。** 只看 mtime 會把前者誤判成後者。
  兩個錯理由結論同向(都是「不要動」),所以**沒有任何東西會告訴你理由錯了** —— 這正是要記的原因。

- **引用 `ListAgents` / `git log` / `pgrep` 這類會漂的觀測**
  → **要嘛當場重查,要嘛寫明幾點量的。** 顧問把四十分鐘前建 cron 時的 `ListAgents` 快照
  寫成現在式(「現在有兩個 session 在顧」),那是**把過期的觀測講成當下的事實**。
  跟上面那條同族:變數不是排除法,是時間。

- **要查「還有沒有別的地方也這樣」**
  → **用名冊(roster)列舉,不要用 grep。** grep 只找得到**你想得到的那幾個字**;
  名冊才找得到**你想不到的**。實例(2026-09-12):要查「還有哪支守門自帶一份排除清單」,
  查法是 grep 那個目錄名 —— 那只抓得到「自帶**同一個值**」的,抓不到「自帶**同一段邏輯**」的,
  於是漏掉了 `check-doc-rot.ts`(它自己複製了一份 `resolveSkipDirs`)。
  正確形狀跟零輸入守門一樣:**列舉 `scripts/check-*.ts`,斷言每一支都真的呼叫共用函式;
  沒呼叫的要明講在豁免清單並附理由,兩邊都沒有就紅。**

  **語句沒有 import,你沒辦法 grep「所有假設了 X 的東西」。**但那句舊話通常在講一個具名
  的產物,而產物名 grep 得到。**改變一個「會被印出來、會被別人引用」的輸出的行為時,
  拿那個輸出的字面(`scanned=`、`gate=`、`result=`)去 grep 全部文件與 skill。命中的每一處
  都要問:這句話在新行為下還成立嗎?**語句沒有 import,但它引用的產物有名字——用名字當
  import 表。三個對象要分清楚:

  | 你在找什麼 | 用什麼 | 原因 |
  |---|---|---|
  | **還有誰也這樣做**(違規) | **名冊** | grep 只找得到你想得到的那幾個字 |
  | **還有誰提到這個名字**(引用) | **字面** | 你要找的東西本來就是那個字面 |
  | **我自己剛剛說錯了什麼** | **字面掃自己的 outbox** | 你剛學到的事最可能打翻的是你自己十分鐘前講的 |

  第三條的完整做法是:**讀完一份程式碼或資料之後,拿它的名字(檔名、輸出字面、旗標名)去掃
  自己最近說過的話。不是掃別人的文件,是掃自己的 outbox。**觸發點是「我剛剛第一次讀懂了
  關於 X 的某件事」；範圍限定最近，是因為閱讀與斷言連著發生，成本接近零。這跟「找違規用名冊」
  不衝突：差別在你找的是「還有誰也這樣做」還是「還有誰提到這個名字」。
  兩個真實例子：協調者讀 `packages/core/src/llm/spend.ts` 確認價格表時，沒有回頭檢查自己
  十分鐘前說的「上限會壞掉」是否仍成立；技術顧問讀 `scripts/check-all.ts` 確認 `--fail-fast`
  是選用時，也沒有把同檔 `scanned=` 的註解與自己剛提的建議連起來。這條規則本身也剛被用過：
  讀完 `check-all.ts` 後掃 outbox，發現工單寫死「18 步、scanned=18」，但本輪正把 chain 變成
  19 步，已發更正。前兩則都是事後才被別人抓到、各付出一次往返；第三則只花**一個 grep、
  兩個檔、三十秒**。

  **稽核方法不能用結果觸發。**「答案錯了沒有」問不出來。要問的是：「這個方法有可能給我錯的
  答案嗎?」——不是「它這次錯了嗎」,是「它**有沒有能力**錯」。有能力錯而這次剛好沒錯,方法
  就不能留。

- **`git merge` 沒報衝突,不代表合併對了**
  → **合併完真的去讀那個檔。** 實例(2026-09-12):main 與分支各自在 `gates.config.json`
  **同一個物件的不同位置**插入 `"skipDirs"` 鍵 —— 行層級沒有重疊,git 自動合併「成功」,
  結果是**一個 JSON 物件裡兩個同名鍵**,`JSON.parse` 靜靜取最後一個,沒有任何東西會報錯。
  **git 的合併單位是行,JSON 的語意單位是鍵**,兩者不對齊的地方就是這種洞。
  worker 做對的事是**合併完真的去讀了那個檔**,而不是相信 git 沒報衝突 ——
  跟「不信『理論上不衝突』」同一條。

- **要刪掉一個東西(不只是改它)**
  → §4a 上面那條「改變一個被引用的輸出之前,拿它的字面去 grep 誰在讀它」的對象是**修改**。
  **刪除也是修改,但下游後果完全不同:**

  | 抽屜 | 動作 | 下游看到什麼 |
  |---|---|---|
  | 1 | **改變**輸出的格式 | 一個它不認識的值 → **會壞,會有人查** |
  | 2 | **刪掉**那個輸出 | **消費者也一起停止工作** → **不會壞,只是不再有人比對** |

  ⚠️ **第二個更安靜,而且它的安靜有一個特別的形狀:**
  > **「比對不再發生」跟「比對通過」在輸出上完全一樣 —— 兩者都是「沒有人講話」。**

  **那是「印得出來 ≠ 會擋」的最終形式:連印都不印了。**
  **兩問,第二問是新的:**
  1. 誰在讀它?
  2. **它不在了之後,那個讀的人會紅,還是會靜下來?**
     **會紅 → 安全,刪。會靜下來 → 先接上替代品、並證明替代品會紅,才刪。**

  (來源:2026-09-13 我提議收掉 `reports/junit/<sha>.xml` 那套時自己想到的,
  但只寫成一句備註;顧問要求把它變成**驗收條件**。已落進工單 `task_6a616d7cf4f4`:
  「**先證明新的會紅,才刪舊的**」—— 造一個假的消失,確認新比對報「少 1」,還原,
  **這時候才**刪舊的。)

- **發現自己在兩個容器之間選**
  → **先問「它需要被裝起來嗎」。**
  實例(2026-09-13):`run-tests.ts` 那四條紅的探針,我問「要不要記進 baseline?」,
  發現 baseline 與 `excludedMax` **兩個棘輪指向相反方向**,判不了,丟給顧問。
  **顧問的回答不在我的選項裡:**
  > **那四條不進 baseline,不是因為我們容忍它們紅,是因為它們本來就不該存在。
  > baseline 收的是「守門誕生前就有的洞」;這四條不是洞,是量錯對象。
  > 量錯對象的東西不進 baseline,它連缺陷都不是。**

  **我卡住是因為我把「這四條紅」當成一個要被歸檔的事實,於是只剩「裝進哪個容器」這個問題。**

  ⚠️ **同一晚(2026-09-13)同一個形狀出現三次,三次的第三個選項都在清單外:**

  | 誰 | 二選一 | 清單外的那個(真答案) |
  |---|---|---|
  | 鄰居專案協調者 | 「我方程式 vs 網路」 | **誰在共用那台機器** |
  | 我 | 「worker 活著 vs 死了」 | **探針量錯對象**(`pgrep -f claude` 看不到 Codex) |
  | 別人的技術顧問 | 「協調者派了 vs 沒派」 | **工具看不見那一半**(`ListAgents` 上 codex worker 隱形) |

  **三個都不是推理錯,是清單一開始就不完整。**
  而三個都有一個共同的觸發點:**有人遞給你兩個選項,而你直接開始在裡面挑。**
  **判準:二選一之前,先問「這兩個選項是誰給我的」。**
  這是「歸檔會關掉下一個問題」的第二種形式:
  第一種是**歸了類就不再問它還屬於哪一類**;**這次是先假設它一定屬於某一類,
  於是只剩「哪一類」。** **兩個都是選項清單成形得太早 —— 清單一成形,
  清單外面的問題就問不出來了。**

真正該停的只有 §4 那幾條。**把上面這些誤判成停止,比漏掉一個真煞車更常發生。**

## 4c. 「分支上全綠、合併後紅」的兩種形狀(P-49)

分支全綠**不等於**合併後全綠。除了「main 多了分支沒有的守門」(§2.1),還有兩種**測試自身**的形狀:

1. **測試把「一定在 worktree 裡跑」內建成假設** → 到 main 就**永遠紅**。
   實例:`expect(seen).not.toBe(join(REPO_ROOT, '.stryker.lock'))` —— 在 worktree 裡兩者不同所以綠,
   在主 repo 裡兩者本來就相同所以紅。**涉及路徑的斷言要在 worktree 與 main 兩種位置各跑一次。**
2. **main 上有分支看不到的檔案被規則掃到** —— 協調者自己寫的文件(它可能為了**描述**一個錯誤
   而引用那個錯誤的字串)。掃描類測試要跳過**巢狀簽出**,而判斷方式是 **`existsSync(dir/.git)`**,
   不是把某個目錄名字寫死。
   ⚠️ 我當初寫死 `.claude/worktrees` 並說那是「別的 repo 的簽出」—— **那句是錯的**,
   `git worktree list` 一查就知道那是**這個 repo 自己的 worktree**。理由講錯,規則就會抓錯範圍
   (1051 檔 12 違規 → 改對後 616 檔 0 違規)。**寫 SKIP 理由前先跑一次 `git worktree list`。**

3. **「守衛」本身是套套邏輯 —— 條件由被測的那個函式決定。**
   我寫過這個:
   ```ts
   const inWorktree = strykerLockPath() !== join(REPO_ROOT, '.stryker.lock');
   if (inWorktree) expect(seen).not.toBe(join(REPO_ROOT, '.stryker.lock'));
   ```
   看起來是「只在 worktree 裡才斷言」,實際是:**把 `strykerLockPath()` 改壞 → `inWorktree` 變 false
   → 斷言整個跳過 → 測試仍然綠。** 守衛把它要守的東西關掉了。
   **判斷法:問「如果被測的東西壞掉,這個 if 會不會讓斷言不執行?」會 → 就是套套邏輯。**
   正解是**自己蓋環境**(建臨時 git repo + worktree,子行程 `cwd` 指過去),
   讓「在 worktree 裡」變成測試**製造**的事實,而不是**向被測程式詢問**的答案。
   同族:`if (skip) return` 型的條件跳過、用被測函式算出期望值。

4. **新增 `scripts/*.ts` 的工單,驗收者要單跑 `npx vitest run scripts/zero-input-guard.test.ts`。**
   名冊(`scripts/zero-input-roster.ts`)要求每個 `scripts/*.ts` 都登記;worker 與驗收者不跑整鏈,
   就會「分支綠、合併後整鏈紅」(實例:T22 的 `review-sidecar.ts`、`review-sidecar-stdio.ts`,2026-10-17)。
   這是 §4c 第一種形狀的又一例。

**協調者為了修 main 紅燈而動測試檔**:可以先修(§4「先修 main」優先),但**同一輪必須開一張 review 工單事後覆核**,
工單裡逐處列出「為什麼是測試錯不是實作錯」。覆核者判定任一處其實是**放寬** → **退回**。

**跑完驗證鏈,刪掉自己的舊 verify 工作樹**(2026-10-17):每個約 3G(node_modules + cargo target),根目錄 `/` 放 /tmp,
累積到 100% 時整鏈會在一分鐘內假紅(`degraded-report.test.ts` 十條紅,單跑 81/81 綠)。
只刪自己登記過的;刪前量 porcelain 為 0、commit 已在 main 裡;之後 `git worktree prune` 並看 `df -h /`。
起鏈前也先看 `df -h /`。

## 4b. 平台操作備忘(Orca,實際踩過的)

- **驗證簽出不要改名,要換就刪了重開**(2026-10-17):`git worktree move` 之後 cargo 快取裡的絕對路徑失效,preheat 回 rc=101。

> ⚠️ **2026-10-14 起 worker 改用 grok(Codex 訂閱停了)。** 本節標「Codex」或 `claude` 的畫面字樣、`worker-start`、
> `claude --dangerously-skip-permissions` 的做法是**歷史紀錄**;**教訓保留**(送出回執 ≠ 對方收到、探針要先證明能回「有」),
> **字面不能照搬到 grok**。現行派工與 grok 的畫面見 §4f。

- `worker-start --worktree new-top-level` **一定要帶 `--name`**,不帶會 `invalid_argument`
- `worker-start` 只用在一個 worktree 的**第一輪**。同一 worktree 的第二、三輪(debug / 再審):
  `terminal create` → `terminal send 'claude --dangerously-skip-permissions' --enter` → `terminal wait --for tui-idle` → `dispatch --inject`。
  少中間兩步會 `no recognized agent detected`;重用舊終端機常 `agent_unconfigured`。**永遠開新終端機**,交接靠 worktree 裡的 REVIEW.md(P-17)
- **dispatch 之後不要看回傳值,去看對方的狀態。**(2026-09-05,`nightmare-assault` 回饋)
  他們用 `terminal send` **少了 `--enter`** → 文字進了草稿框 → 回 `{"ok": true}`;**連送四封全 ok**,
  接收端閒置 **42 分鐘**、`in:0/out:0`、`ctx 0%`。是因為「工人 25 分鐘沒 commit」才去看螢幕發現的。
  **判準一句:這個 `ok` 證明的是「我的動作成功」,還是「對方真的收到了」?**
  絕大多數 API 的回傳值裡這兩件事是同一個 `ok`。
  **檢查:dispatch 後幾分鐘內讀對方螢幕,看三件事 —— (a) 沒有 `draft:` 那一行、
  (b) token 計數 / ctx% **從 0** 動起來、(c) 第一個 commit 出現。三者皆無 → 當作沒送到,重新交接。**
  ⚠️ **(b) 只能用來判斷「它有沒有開始過」,不能用來判斷「它有沒有收到我這一則」。**
  我寫完這條一小時後就自己踩了:worker 閒置在 `❯`、`in:247850` 連續兩次輪詢 20~25 圈都不動,
  我兩種送法(`orchestration send` 與 `terminal send --text --enter`)都回 `ok`,於是判定「沒收到」——
  **但它其實收到了,而且照我說的 commit 了 WIP**。預覽裡的計數不是即時的。
  **會話中途要判斷「它收到了嗎」,唯一可靠的訊號是 (c):`git log` / `git status` 有沒有動。**
  那也是三個訊號裡唯一**不經過那個可能壞掉的工具層**的一個。
  (這是我把 nightmare 那條規則**過度一般化**的結果:他們的原始情境是 `in:0/out:0` 的**全新 session**,
   問的是「它有沒有啟動」;我把它套到「它有沒有收到這一則」,那是不同的問題。
   —— 跟我一小時前抓到技術顧問「量了 A 推廣到 B」是同一個形狀,這次是我。)
  卡住的草稿用 `--interrupt` 清掉(他們實測有效)。

  ⚠️ **`pgrep -f claude` 看不到 worker,因為 worker 不是 claude。**(2026-09-13 實測;當時 worker 是 Codex。現在換 grok,同樣看不到 —— 探針改用 `/proc/*/cwd` 在 worktree 路徑下的行程,見 §4f)
  我想判斷三個 worktree 的 agent 還活著沒,跑
  `for p in $(pgrep -f claude); do readlink /proc/$p/cwd; done` —— **三個 worker worktree
  一個都沒有**,六個 claude 程序全在主簽出。差點下的結論:「agent 都死了,而其中一個
  還有未提交的工作沒人收」。**真相:worker 是 Codex(`gpt-5.6-luna`),那個探針
  不可能看到它們,不管死活 —— 它是一個永遠回「沒有」的探針。**
  (同一分鐘那個「疑似死掉」的 worker 自己 commit 了。)
  **判準(跟「這個紅是量出來的還是探針壞了」同族,但更前面一步):**
  > **一個從來沒回過「有」的探針,先證明它能回「有」,再拿它的「沒有」下結論。**
  驗法:拿那個探針去量一個**你確定活著**的對象(例如自己的 session)。**成本一次。**
  **這條跟「沒紅過的守門不算接上」是同一句話,只是換到了臨時敲的一行診斷指令上** ——
  守門我們要求「先弄壞讓它紅一次」,**臨時查詢沒有這道要求,而誤判正是從那裡來的。**

  ⚠️ **`stage: input_accepted` 也會騙人;`100% context left` 才是最好的開工偵測。**(2026-09-13 實測;**Codex 的畫面**,grok 沒有這個字樣,見 §4f。教訓仍成立:送出的回執不等於對方開工。)
  同一批派三個 worker,三個都回 `{"state":"ready","stage":"input_accepted"}`,
  **其中一個的工單卡在草稿框裡一個字都沒送出,閒置約 40 分鐘。** 螢幕上是:
  ```
  › [Pasted Content 7876 chars]   tab to queue message      100% context left
  ```
  **那個欄位比一般的 `{"ok": true}` 更像證據,但它證明的仍然只是「文字送到那個終端機了」。**
  **欄位叫什麼不重要,它站在工具層的哪一邊才重要。**
  **補一個訊號,而且它比 (b) 好:**
  > **一個已經讀過工單的 agent 不可能還在 100%。派工後幾分鐘讀螢幕,
  > 看到 `100% context left` → 它沒開工,不用再看別的。**
  (b) 要你比較兩個時間點的數字、而預覽的計數不是即時的;**這一條是單一畫面上的絕對事實。**
  **修法(實測有效,一個位元組):`orca terminal send --terminal <handle> --text "" --enter`**
  —— 只送 Enter 把已經貼進去的內容送出去,**不要重貼工單**(會變兩份)。
  25 秒內螢幕就從 `100% context left` 變成 `• Working`。
  **這次是靠 (c) 抓到的(別人都 commit 了它還停在 base),但 (c) 是滯後指標** ——
  要等「別人做完了」這個對照出現才顯眼,花了 40 分鐘。
  **所以:派工後幾分鐘用 `100% context left` 做早期檢查,之後才靠 (c) 當長期訊號。**

  ⚠️ **送出之後要不要確認對方收到,取決於「答案在誰手上」。**(2026-09-13,顧問給的判準)
  同一天第二種形狀:`orchestration send` 回 `Sent msg_…`,兩台 worker 螢幕卻停在閒置
  提示符、連草稿都沒有。**兩種形狀的共同點是同一句:`Sent` / `input_accepted` 都是
  「我這一端的動作成功」的回執,不是「對方收到」的回執。**
  但**每次都確認回執太貴,那條規則不會被執行**。所以:
  > **送出之後,如果那個答案只有對方拿得到,就要主動確認它收到了**
  > (看它的螢幕有沒有動,或要求它回一個字)。
  > **答案你自己查得到的,送出即可,不用確認。**
  那次我問的兩件(變異的 compile error 分母、名冊那 7 支清單)**我自己都查得到**,
  所以沒有擋住任何事 —— 但下一次可能是只有對方知道的東西。
  ⚠️ **不要用 `terminal show` 有沒有報錯來驗** —— 工具的話正是壞掉的那一層,拿它驗它自己是套套邏輯(§4c 第 3 種)。

- **worker 用 `orchestration ask` 阻塞時,只能用 `orchestration reply --id <msg_id>` 解,`send` 不行**(P-45)。
  `send` 送得到那個終端機,但**不會解除 `ask` 的阻塞** —— worker 等到逾時後自己走保守選項,
  而協調者以為自己回了。**兩邊都以為溝通成功,而且沒有任何錯誤訊息。**
  判斷:`check` 回來的 message `type` 是 `question` → 用 `reply`;其他才用 `send`。
  **順序也重要:先 `reply` 再 `ack`** —— ack 之後 `check` 就抓不到那個 msg_id 了,只能退而用 `send`(就是踩坑的那次)。
- `check --wait` 可能回**已處理過的舊訊息**(`"replayed": true`),要 `--ack <deliveryId>` 再等下一則,不然空轉
- 開 worktree 明確指定起點(`--base-branch main` 或 `git worktree add -b <branch> <path> main`),開完驗 `git merge-base --is-ancestor main <branch>`(P-18)
- **新 worktree 有三樣東西 clone 完不會自動有,派工時要講**(2026-09-05,worker 自己撞到並自己解決,但下一個還會再撞):
  1. **`.env`** —— 沒有它 `npm test` 的全套跑不動。worker 要自己
     `export LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10`,
     或從主簽出連過去。
     ⚠️ **不要用 `npx tsx scripts/llm-spend.ts --today` 當驗證** —— 這裡曾經寫「要回 0 或 1,
     回 2 就是沒設好」,**那是錯的**:新 worktree 沒有 `learning/`(它 gitignore),
     所以**變數設對了也一樣回 2**(`算不出來:讀不到 log 檔 learning/state/log.jsonl`)。
     2026-09-05 實測:`lock-orphan` worktree 有 export、無 `learning/` → **rc=2**。
     **那條驗證會給假警報,而假警報跟真警報長得一樣。**
     **要驗就直接驗那個檔**:`npx vitest run scripts/zero-input-guard.test.ts` 綠。
     (同日實測:主簽出移走 `.env`、沒 export → **12 紅**;移走 `.env`、有 export → **579 綠**。
      所以 **export 是有效的** —— 之前有人說「export 也傳不進探針」,那句重現不出來,別照抄。
      真正的問題是「乾淨簽出沒人 export 就紅」,所以 `env-probe` 那張把值注入進測試檔。)
  2. ⚠️ ~~**pre-commit hook**(`scripts/hooks/pre-commit` 要自己 `cp` 到 `.git/hooks/` 並 `chmod +x`)~~
     **本 repo 刻意不裝這支 hook,派工說明不要再叫 worker 裝。理由見 ADR-048。**
     取而代之的是測試(守 `stryker*.json` 的 `inPlace`,以及 `strykerArgs()` 收到 `--inPlace` 要硬錯)。
     劃掉不刪,因為**這一條錯了兩件事**,兩件都值得下一個人看到:
     - **它不是「每個 worktree 一份」,是全域的。** linked worktree 共用 `$GIT_COMMON_DIR/hooks`
       (三個 worktree 的 `git rev-parse --git-path hooks` 都指主簽出的 `.git/hooks`)。
       **一個 worker 裝,所有人都裝上**,而且 `git status` 看不到、版控裡也沒有。
       這個錯誤在單一簽出的專案上永遠不會顯現。
     - **裝了之後,任何人在跑變異測試,全部 worktree 包含 main 都不能 commit**(殘鎖則是永久封鎖)。
       而它防的危害(就地改檔)在本 repo 不存在 —— 13 個設定的 `inPlace` 全部未設定。
  3. **`TEMPLATE_DIR`** —— `check:gates` 在 worktree 要設,不然找不到模板。
  這三樣的共同形狀是「**在版控外面**」,所以 `git clone` / `worktree add` 都不會帶。
  模板 1.4.2 會把它做成 `TASK.md.template` 的第 0 步與 CHECKLIST 的一節;**在那之前由派工說明帶。**

  **派工說明的通則:**不要給平行行動者「答案」,給它「取數的方法」。任何你在派工當下算出來、
  而 worker 執行時可能已經變了的數字都適用:chain 長度、基準值、`scanned=N`、下一個 phase
  編號、下一個 ADR 號。每個 worker 的資訊都是正確的,而正確的資訊互相矛盾；這是「把共享
  狀態的衍生值發給平行行動者」的簽名。派工時應把取數指令本身寫進工單，讓 worker 在寫入
  或量測的當下重新取得數值。

  ⚠️ **但取數指令只解「過期」,不解「同時取」。** 2026-09-12 實測:`roster-location` 與
  `template-fresh` 兩個 worktree **各自正確地跑了那條取號指令**、各自讀到「目前最大 053」、
  於是**兩個都寫了 ADR-054**。指令沒錯,worker 沒錯,**兩份資訊各自都是對的** ——
  這正是上一段那句「正確的資訊互相矛盾」,只是原因從**時間差**換成了**併行**。
  **判準:那個數字是「讀出來的」還是「配出來的」?**
  - **讀出來的**(chain 長度、`scanned=N`、基準值)—— 取數指令就夠,誰讀都得到同一個答案。
  - **配出來的**(ADR 號、phase 編號、任何「下一個未用的」)—— 取數指令**不夠**,因為
    兩個人同時讀會拿到同一個空位。這種要嘛由協調者在派工當下**配號並記下**,
    要嘛靠一支**會紅的守門**在合併時抓(`check-adr-numbers.ts` 就是為此而存在)。
  兩條都做:協調者發現併行的兩張都要寫 ADR 時,**當場指定誰用哪一號**;守門是安全網,不是流程。

- **續用舊 worktree 之前先 `git merge main`(不 rebase)。** P-18 只管「開的時候」,但一個 worktree
  活好幾輪之後,main 早就往前跑了 —— 實例:`a93e59b` 的 base 落後 origin/main 約 6 條。
  那次無害(中間沒人動同一批檔),但**無害是運氣,不是設計**。先 merge 的好處是
  **main 新加的守門會在分支上就撞到**,而不是合併後才撞(那正是 §4c 要防的)。

## 4d. 四條從 2026-09-13 收工補進來的規則

來源是 `handoff-2026-09-13` 的重點;原稿已遺失,這裡是依重點重寫,**措辭與舉例不是原文**。

1. **查自己的狀態要兩半。**
   - 第一半:宣稱「我現在是 X」「那個東西的行為是 Y」的人,**先跑一次那個查詢**再講,不憑記憶。
   - 第二半:接收的人**要原始輸出,不接受斷言**。第二半不需要能查那件事 ——
     矛盾不需要知識,只需要記錄(對撞對方前後兩句話就看得出來)。

2. **選張的依據不是排隊順序。** 依據是「現在做它的成本與收益」,而成本要算進
   **「我自己背景還欠多少」**(沒收的合併、沒回的驗推、沒清的 worktree)。排隊順序只是紀錄,不是理由。

3. **派工後的開工確認是固定一步,不是坑清單裡的提醒。** 派工後讀 worker 的畫面,看到「它在做事」的訊號才算開工;
   沒看到就當作沒送到。**訊號是哪個字樣取決於 worker 用什麼 agent:**
   - Codex(已停用):`100% context left` = 沒開工;變成 `Working` = 開工。等 25 秒再看。
   - grok(現行):`Waiting for response…` 或 `Worked for <N>s` = 開工/做完;見 §4f。
   > ⚠️ **Codex 的「25 秒」是當初量出來的值,依據已遺失;grok 沒量過等待時間,我們沒有 grok 的門檻。** 不要替它補理由;需要時重量。

4. **判斷 load 看趨勢,不看絕對值。** `uptime` 的三個數字:**1min < 5min < 15min = 退潮**(在降);
   **1min > 5min > 15min = 還在漲**。同一個 30 在退潮時可以開工,在上升時不行。
   這條的前提是「load 是這台機器上所有人共用的」,前提不成立(例如換到獨占機器)時判準要重看。
   ⚠️ **load 是自己的函數**:整套測試起跑 90 秒內 load 會從 24 跳到 50(vitest 自己開了約 7 個 worker),
   所以「等 load 降到 X 才跑完整套件」的門檻**永遠等不到** —— 你等的是你自己即將製造的東西。
   這條看趨勢是用來決定「要不要再疊別的東西」,不是決定「完整鏈能不能開」;完整鏈用 `VITEST_MAX_WORKERS=1`(§4e)壓住自己。

## 4e. 派工前置、非作者驗證、環境備忘(2026-10-01,技術顧問批准)

### 派 worker 的前置(四件,缺一不算派好)

1. **worker 手上沒有 provider key,且要量,不是宣稱。**
   - 自己起的行程(例如 `terminal create --command`)可以加 `env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY <agent 指令>`。
   - **`orca worktree create --agent grok --prompt …` 起的行程是 Orca 起的,我們加不了 `env -u`。**
     改成**派後量 worker 行程環境的鍵名**(只比鍵名,不印值),0 命中才算過:
     ```bash
     for p in $(ls /proc | grep -E '^[0-9]+$'); do c=$(readlink /proc/$p/cwd 2>/dev/null); case "$c" in "<worktree 路徑>"*) echo "pid $p keys:[$(tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -oE '^(OPENAI|ANTHROPIC|XAI|GOOGLE|GEMINI)[A-Z_]*=' | tr -d '=' | tr '\n' ',')]";; esac; done
     ```
     這是**這一次、這個 Orca 行程環境**的事實,不是保證 —— 每次派工都量,不沿用。(2026-10-14 顧問批准;理由:`env -u` 對不存在的變數也靜默成功,「我 unset 了」是斷言,「量到沒有」是證據。)
   - **opencode worker(2026-10-15)**:opencode 用**登入檔**(`opencode auth list` 看有哪些)取 xAI 憑證,**不是環境變數**。所以行程環境量到 0 個 provider key 是**預期**,不是漏洞;
     這一條對 opencode 的意義只剩「Orca 沒有把我們的 key 變數帶進去」。實際測得的鍵名只有 Orca 自己的 `ORCA_AGENT_LAUNCH_TOKEN`、`ORCA_AGENT_HOOK_TOKEN`。
     **opencode 的派前檢查改為:worktree 內 `opencode.json` 存在,且 `permission.skill` 全 deny**(`jq -c .permission.skill <worktree>/opencode.json` 應為 `{"*":"deny"}`;只印這一個鍵,不貼全文)。
2. **worker 第一步回報原始輸出**:`echo "${OPENAI_API_KEY:-UNSET}"; echo "${ANTHROPIC_API_KEY:-UNSET}"`,兩個都要是 `UNSET`。
   收的人要輸出,不收「我 unset 了」(`env -u` 對不存在的變數也會靜默成功)。
3. **派工前量檔案**:`ls <worktree>/.env` 必須回 `No such file`,輸出貼進回報。**這步才是真的在保護的那層。**
   `scripts/llm.ts` 與 `scripts/_env.ts` 用 `process.loadEnvFile(new URL('../.env', import.meta.url))`(ADR-034),
   路徑相對於腳本所在的簽出,且不覆蓋已存在的變數 —— `env -u` 讓變數「不存在」,`.env` 反而把它補回來。
   所以 worker 安全是因為它的簽出裡沒有 `.env` 這個檔,不是因為 `env -u`。
4. **禁止在主簽出派 worker**(禁止項,不是建議):主簽出有 `.env`。

第二個 clone `/data/python/llm_learning-cards-workers`(push URL 已停用)同時做到「推不出去」與「拿不到 key」。
⚠️ 但帳本(`resolveVaultLearningDir`,用 `git rev-parse --git-common-dir`)與 `.stryker.lock` 只解 worktree 不解 clone:
三個 clone = 三份日上限。**開 clone 之前先列「還有什麼東西的範圍是從 repo 根算出來的」。**
~~**煞車(2026-10-01 顧問):帳本範圍修好之前,任何 clone、任何 worktree 都不准 `--live` 或任何會打真 provider 的東西。**~~ **已於 2026-10-15 解除,現行規則見 §4g 第 22 條**(真呼叫只在主簽出跑,worker 的簽出沒有憑證)。
(2026-10-14 顧問確認解讀:**grok worker 自己的模型呼叫是 agent 的成本,不是專案的 LLM 呼叫**;專案程式碼的 `--live`、golden run 真模型在當時禁止;2026-10-15 起依 §4g 第 22 條處理。)

### 非作者反向驗證(§2 第 1 步)要加的

對**新增或修改的測試檔**:
1. `grep -nE 'rmSync|rm -rf|unlinkSync|writeFileSync|mkdirSync'` 有沒有命中?
2. 命中的目標路徑是**字面常數**還是**執行時算出來的**?算出來的要追到底看它可能指向哪。
3. 目標落在 `learning/`、`state/`、`raw/` 或任何 git 追蹤路徑底下 → **退回,不管護欄多緊**。護欄是條件,會失效,而且失效時測試還是綠的。

實例(2026-10-01):T1 的 `live-run.test.ts` 在 `finally` 裡 `rmSync(resolveVaultLearningDir(ROOT), { recursive: true })`,
協調者只跑了測試與突變、沒讀副作用,技術顧問抓到。
另:**非作者要選一個不在作者清單上的突變點**;tree sha 開跑與跑完各記一次,不同就作廢。

### 合併後跑 check:all 的兩個條件(顧問 2026-10-01 實測)

- **模板要釘版本**:`check:gates` 預設對「活的」`/data/python/dev-loop-mcp` HEAD(舊名 dev-paradigm,2026-10-23 起改這個路徑,同一個 git repo 延續,歷史與 tag 都在),同一個 commit 會隨時間由綠變紅
  (上游 `0d02c74` 起要求 `.npx-init-manifest.json`)。釘我們檔頭的版本:
  `git -C /data/python/dev-loop-mcp archive v1.6.8 | tar -x -C <目錄>`,再 `TEMPLATE_DIR=<目錄>`。**只有 `check:gates` 單獨紅在 manifest 那一行時,照此判斷,不要去修,也不要當成自己合壞。**
- **限 worker 數**:`VITEST_MAX_WORKERS=1`。預設約 7 個 worker 會把 8 核吃到 load 50–78,逾時全是自我競爭;
  **2 個 worker 在同一條件下有綠有紅**(同一份程式、load 24–28:`degraded-report.test.ts` 那個會起內層 vitest 的測試,
  孤立最慢 3 秒,鏈內 5.65 秒,一次綠一次紅)。timeout 與斷言不動。T3 量出曲線前一律用 1。
- 指令:`VITEST_MAX_WORKERS=1 TEMPLATE_DIR=<目錄> npm run check:all`。
- **回報要帶**:host、核數、worker 數、起跑與結束的 1/5/15 分 load、樹 sha 前後。沒有這些欄位,事後分不出「程式變慢」和「機器變忙」。
- 上一條的處理是量測條件,不是標準;T3 / T4 會把它們變成機制。
- **預熱後先 `sync` 再等 IO 安靜,才起 `check:all`**(顧問 2026-10-18,T29 根因):真 fsync 型測試的逾時,都落在預熱(`cargo build --bin lc-fs`)結束後 1–2 分鐘——cargo 留下的髒頁在這時被核心寫回,壓在 vitest 剛開跑的時候(a2e5c3c:03:42–03:43 IO full 到 82;17a1387:20:02:30–20:03:30 到 44;中間 15–17 分鐘是 0)。鏈的程序:預熱完 → `sync` → 等 `/proc/pressure/io` 的 `full` `avg10` < 5(上限 3 分鐘,**等了多久記進 meta**)→ 才起 `npm run check:all`;每秒取樣多記 `/proc/meminfo` 的 `Dirty`、`Writeback`。鏈尾還有一個 IO 尖峰(04:00 到 46、20:21 到 41),是哪一步造的下次看 JSON reporter + 取樣,先記不修。連看 3 次整鏈(加了等待之後),預熱窗外還有真 fsync 型逾時,才回頭做 T29 原本的「fixture 改 `writeFileSync`」。
- **整鏈有逾時紅時,送「請驗推」的條件**(顧問 2026-10-18 裁決,T31 a2e5c3c):
  1. 紅的只有逾時(`Test timed out`),0 條斷言失敗;
  2. 這批沒碰那個測試檔,也沒碰它 import 的模組;
  3. 同時段的 `/proc/pressure/io` 顯示磁碟停頓(full avg10 高),且同窗 `ps` 前幾名 CPU 沒有外部大戶;
  4. **失敗的那個測試檔,在同一份簽出單獨重跑,連 2 次綠。**
  整步(例如 `check:test-ledger`)重跑是額外資訊:裡面出現**另一條同檔、同型(真 fsync)的逾時**不擋;出現斷言失敗、或別型、別檔的紅就擋。
  證據一律附:逾時那條的耗時、PSI 窗口、單跑兩次的 `Test Files`/`Tests` 原文。(實例:T31 a2e5c3c,整鏈 `mutate.test.ts` 3 條逾時、單跑 185/185 ×2、整步重跑 1 次綠 1 次另一條同檔逾時,顧問裁收;真 fsync 型逾時由 T29 處理。)

### 環境備忘

- workers clone 登記進了 Orca(`orca-ide repo add`);撤銷 `orca-ide repo remove`。環境副作用要登記。
- §4d 第 4 條的 load 判準是**紀律不是機制**:擋不住整條鏈同時跑。等 T3。`cargo-mutants` 也要拿 `.stryker.lock`。
- Codex 啟動坑(**Codex 已停用,保留為歷史**):更新提示(加 `-c check_for_update_on_startup=false`;**別按 Enter**,選項 1 會 `curl | sh`)、
  信任目錄提示(新 clone 第一次會問)、`codegraph init` 會問(小範圍回「不要」)、`terminal send` 要加 `--enter` 才送出。
- **停一棵測試樹**:用 `/proc/*/cwd` 找「工作目錄在某路徑底下」的所有 pid,逐一停。
  **不用行程組**(`run-tests` 把 vitest 放在另一個組,對行程組發訊號殺不到;實例:殺過一次,13 個行程還活著、
  `.stryker.lock` 還被持有),**不用 `pkill -f`**(下一條)。停完要再列一次確認沒有剩的、鎖也釋放了。
- **`pgrep -f` / `pkill -f` 會比中自己的命令字串。** 撈到的行先排除自己再當證據;比對完整 argv 並排除自己的 PID。
- **輸出的結論行必須依賴量測結果。** 無條件 `echo "(以上為空 = 沒有…)"` 看起來跟有條件的一模一樣;要嘛 `if` 判命中數,要嘛不印結論只印原始輸出。

## 4f. 派工(grok 版,2026-10-14 起;依據是 2026-10-14 協調者與顧問自己量到的)

**現行派工指令**(從 workers clone 開,先 `git -C /data/python/llm_learning-cards-workers fetch origin`,base 是 origin/main):
```bash
orca-ide worktree create --repo id:<workers repo id> --name <名> --agent grok --prompt "<工單>" --setup skip --no-parent --json
```
- **一定用 `--agent grok --prompt`**:這樣 worker 才會出現在 Orca 側邊 worktree 卡片(使用者要求看得到)。**不要在背景用 `grok -p` 無人值守跑**(不會出現在卡片)。
- 回傳的 `startupTerminal.handle` 就是 worker 的終端機。Orca 起的指令列是 `grok --permission-mode bypassPermissions -- <prompt>`。
- **prompt 長度**:15.7KB 直接塞命令列,2026-10-14 實測可行(grok 正常啟動並開工);**上限沒量過**。更長就改成「prompt 只放一句指向工單檔的絕對路徑」,工單本體放 worktree 外的檔(工單唯一正本、一字不改)。
- **使用者要求不加限制**:不開 `--sandbox`(顧問說這台起不來,使用者也不要);除了 §4e 的三件零成本防護,不加新規則。
- **第一次在新 clone 開 grok** 會問「信任這個目錄嗎」(顧問答 y)。在 workers clone 開第二個 worktree 沒有再問(協調者 2026-10-14 實測);新 clone 沒量。
  (這與 Claude worker 同形:信任記在 git repo 根,見下方「Claude worker」。)
- 畫面底下的 `Help improve Grok [Opt out] [Opt in]` 預設 Off,**不要 opt in**。

**派工後的三件量測(缺一不算派好;都要貼原始輸出)**
1. `ls <worktree>/.env` 必須 `No such file`(§4e 第 3 條)。
2. worker 行程環境的 provider key 鍵名 0 命中(§4e 第 1 條的指令)。
3. 讀 worker 的畫面(`orca-ide terminal read --terminal <handle> --json`):看到下面「工作中」或「完成」才算開工。

**grok 的畫面(2026-10-14 協調者實測,grok 1.0.52)**
- 頂列:`<branch> worktree <path> 31K / 256K │ [Dashboard]`(`31K / 256K` 是 context 用量,**開機就有**,不是「沒開工」的訊號);底框 `Grok 4.7 (high) · always-approve`。
- 工作中:`⠦ Waiting for response… 10s ⇣31.3k [stop]`。
- 做完:答案後一行 `Worked for 16s`。
- **沒量到的**:「剛開工那一幀」(create 後 8 秒內就做完了)、`terminal send` 不帶 `--enter` 時草稿框的樣子。**不要替這兩個編字樣。** 送訊息仍要帶 `--enter`(帶了之後 1~2 秒內進入 `Waiting for response…`)。

**判斷 worker 還活著**:`/proc/*/cwd` 在 worktree 路徑底下的行程(不是 `pgrep -f claude`、不是 `ListAgents`)。
**注意**:grok 行程會連帶載入 `agent-bridge`(`bridge.py --name claude`)、codegraph、pencil MCP,所以 worker 可能出現在 agent-bridge 上;與 Codex 在 `ListAgents` 隱形的情況不同,**沒量**。顧問:低優先,看到 bridge 上出現 claude 名字的流量再回報。

**用量(每張工單收工都記)**
- `grok usage <SESSION_ID>`(`SESSION_ID` 在 worker 行程環境的 `GROK_SESSION_ID`,是 id 不是機密)印 JSON:`totalTokens`、`modelCalls`、`costUsdTicks`。
  **要在回合結束後才查**(畫面出現 `Worked for …` 之後)。worker 在回合中自己查會回「No usage recorded」,所以這個數字由協調者補。
- 每張都記:ticks 原值、換算美元、模型、回合數、session id。**不要自己改模型或推理強度——那是使用者的決定。**
- **換算:1 美元 = 1e10 `costUsdTicks`**(顧問用 `total_cost_usd 0.147148` ↔ `costUsdTicks 1471480000` 驗過)。回報**同時寫 ticks 原值與換算後的美元**,加上 session id。
- 例:2026-10-14 探針兩回合 `totalTokens 62741`、`costUsdTicks 767500000` = 約 0.0768 美元。

**清理一個 worker**

⚠️ `--force` 對有未提交修改的 worktree 會**直接刪掉**,沒有回頭路。所以 **`rm` 之前先量三件,任一不成立就先處理,不要用 `--force` 蓋過去**
(2026-10-14 顧問刪 7 個 worktree 靠的就是這三件;其中三個有還沒審的報告 commit,先另存成分支才刪):
1. **沒有未提交的東西**:`git -C <路徑> status --porcelain` 輸出 0 行(被 `.gitignore` 排除的不算)。
2. **工作已經在別處**:`HEAD` 已在 main 裡(`git merge-base --is-ancestor <HEAD> origin/main`),**或**已另存成分支。
   兩者都不是 → 先另存:`git fetch <那個 clone> <分支>:<分支>` 到主 repo,**比對 commit 與樹 sha 相同**才算存好。
3. **沒有進行中的工作**:`orca-ide worktree ps` 顯示的 live 終端數 = 0,或已確認那個終端沒有在做事(讀畫面,不靠回傳值)。

三件都成立,才執行 `orca-ide worktree rm --worktree path:<路徑> --force --json`(此時 `--force` 只是因為 Orca 要求,不是用來蓋過檢查)。
之後四邊都要量:目錄不在、`git worktree list` 與 branch 無殘留、`orca-ide worktree ps` 零命中、`/proc/*/cwd` 無殘留行程。
(協調者 2026-10-14 清掉的 grok 探針符合這三件:沒有改動、`HEAD` 就是 origin/main、終端已閒置;但當時是憑「我剛開、什麼都沒做」判斷,沒有逐件量 —— 下次照上面逐件量。)

**清理的範圍(2026-10-15,T3 階段 A 的教訓)**:不管是 worktree 還是 `/tmp` 的暫存,**只刪「自己登記過的清單」**(自己建立時記下的路徑),
**不用「樣式比對 + owner 判斷」去掃**。T3 階段 A 的 worker 用「空目錄、owner 是自己」去清 `run-tests-partial-*-sibling`,誤刪了別人那個時間點剛建的空目錄
(`/tmp/run-tests-partial-NaEr1F-sibling`,不是它的;空的、沒損失,但同形狀的清理遇到非空的就會出事)。
另外 `scripts/run-tests.test.ts` 約 259 行的 `${d}-sibling` 沒登記清理、每跑一次漏一個空目錄,已記為後續小票。

**T3 類(整套測試)工單的收工多量兩件**:workers clone 根有沒有被建出 `learning/`(`ls -d /data/python/llm_learning-cards-workers/learning`,應為 No such file);`/tmp` 與 worktree 的 `.stryker-tmp` 有沒有殘留(只看收工當下新於派工時間的)。

### Claude worker(2026-10-14 起,可用;`orca-ide worktree create … --agent claude`)
- Orca 起的是 `claude '--dangerously-skip-permissions' '<prompt>'`(Opus 5.5 xhigh,Claude Max 訂閱)。
- **信任記在 git repo 根**(`~/.claude.json`),不是每個 worktree 路徑:`/data/python/llm_learning-cards` 與 `/data/python/llm_learning-cards-workers` 都已信任,所以 workers clone 底下新開的 worktree **不會再問**。
  **新 clone 才會問一次,預設選 `No, exit`**:要先送下鍵 `$'\x1b[B'`、讀畫面確認 ❯ 在 `Yes, I trust this folder`,再 `--text "" --enter`。**不可盲按 Enter。**
- 畫面:工作中 `✻ <動詞>… (<秒>s · ↓ <N> tokens · thinking with xhigh effort)`;狀態列 `[Opus 5.5] <名> | ctx N% | in:/out: | $x | 0m<N>s | 5h: N% | 7d: N%`;完成 `✻ <動詞> for 6s · done <時間>`。
  **動詞是隨機的(Caramelizing、Cogitated…),不可當訊號**;穩定的是 `✻ <動詞>… (<秒>s` 的格式與狀態列的計時在走。
- Claude worker **會載入專案 `.claude/skills`,包含協調者專用的 `autopilot`**:工單補充一定要寫「不要使用 autopilot、decision-record 等 skill」。
- 額度與所有 Claude session(含協調者與顧問)**共用**:每張開工、收工各記狀態列的 `$` 與 `5h`/`7d`。狀態列的 `5h` 欄收工時可能不顯示,沒量到就寫沒量到。

### opencode worker(2026-10-15 起;使用者選的 worker:xAI 帳號的 grok 4.7,不是 OpenRouter 金鑰)
**模型與 skill 隔離來自專案根的 `opencode.json`**(`model=xai/grok-4.7`、`permission.skill` 全 deny)。worktree 必須從含 `opencode.json` 的 main 開。
```bash
orca-ide worktree create --repo id:<workers repo id> --name <名> --agent opencode --prompt "<工單>" --setup skip --no-parent --json
```
- Orca 實際起的命令列(量 `/proc/<pid>/cmdline`):`opencode --prompt <整段 prompt>`。**沒有 `--auto`、沒有 `--model`**;模型來自 `opencode.json`。
  3.4KB 的 prompt 直接塞命令列可行。**不要改 `opencode.json`、不要登入或登出、不要讓 worker 改模型**(使用者的決定)。
- **沒有信任提示**,開機直接開工;bash 工具呼叫不彈權限詢問。
- 畫面:模型列 `Build · Grok 4.7 xAI · high`(確認模型與推理強度);工作中左側 `⠸ Thinking` 轉圈、底列 `esc interrupt   <N>K (<p>%) · $<累計>`(token 數、context 百分比、累計美元);工具呼叫顯示 `$ <指令>`、`→ Explored: …`。
  完成:底列沒有 `esc interrupt`,改成 `… · $<累計>  ctrl+p commands`,回覆結尾一行 `Build · Grok 4.7 · 18m 53s · 82.4 tok/s`。
- **畫面可能停在首頁、看不到 `esc interrupt`,但 session 其實已在跑**(2026-10-15 審核者遇過)。**判斷以 `opencode session export <id> --sanitize | jq` 的 messages 數與 `info.cost` 為準,不要連按 Enter**(連按會多送)。
  找 id:`opencode session list --format json -n 5`(最新的在最前面)。
- **用量**:`opencode session export <id> --sanitize | jq -c '.info|{model,cost,tokens,outcome}'`。`cost` 單位是**美元**(與畫面底列一致),**不是 ticks**,不要套 grok 的 1e10;
  `tokens` 有 input/output/reasoning/cache.read。回報寫原值、模型(含 variant)、耗時(`time.idle - time.created`)、session id。
  `--sanitize` 會把文字內容遮成 `[redacted…]`;要看審核者的文字就**去掉 `--sanitize`**(內容只有它自己的輸出,不含使用者資料;仍不進版控)。
- **TUI 換模型用 `ctrl+x m`**(Switch model)。`ctrl+p` 選單在新 session 的第一項是 Switch session,別用 Enter 盲選。`--model` 旗標只有 `opencode run` 認,TUI 啟動不認。
- **審核者**(使用者 2026-10-15 指定由 opencode 做第一輪審):`xai/grok-4.20-0309-reasoning`(選單裡的 `Grok 4.20 (Reasoning) xAI`;**不要選 OpenRouter 的同名項**)。
  這個模型**沒有可切的 effort 檔**(`ctrl+t` 的 variant cycle 按多次底列不變;4.7 才有 `high`)。審核者 worktree 另開(不在 worker 自己的 worktree 裡審),從 worker 的分支開。
  **審核者的 worktree 沒有 `node_modules`,它會只讀檔不跑測試(2026-10-15 第一輪就這樣)**:提示詞要明寫「先用 tar 複製 node_modules(不要用 symlink),跑 vitest 並貼 `Test Files`/`Tests` 原文;沒貼輸出,審核不算數」。
  審核者的結論**不是放行**:協調者自己重跑測試與突變,顧問再對照原始檔下判斷。

### 成本表(給使用者選 worker 用;2026-10-14/15 實際量到)
| worker | 一張的例子 | 帳面 |
|---|---|---|
| grok(grok CLI,1.0.52) | T0-3/4 驗收測試 | $1.76(2 回合,約 257 萬 token,主因每回合背約 8 萬 token 上下文) |
| opencode grok-4.7 high | T4b 小票;T4b 退回修正 | $2.56(18m53s);$0.91(7m) |
| opencode grok-4.20 reasoning(審核) | T4b 兩輪審核 | $0.26;$0.26(約 3 分鐘) |
| Claude(Opus 5.5 xhigh) | T3 階段 A(大量測) | 帳面約 $16.26;7d 額度約 +1 個百分點;5h 沒量到 |
一張小票約 $0.9–2.6;審核約 $0.26;Claude 的大張約 $16。**用哪個 worker 是使用者的決定**,這張表只給選擇用。

## 4g. 2026-10-15 累積規則(技術顧問逐條批准;每條都是當天踩到或量到的)

### 角色與派工
1. **每張工單兩個角色**:測試 agent 先寫紅測試與步驟定義並 commit(不寫 gherkin、不碰實作),開發 worker **只改實作**,驗收者(不是作者)再驗。**起草工單、寫紅測試、審 UI 不要是同一個人**(T2c-2:前端起草,驗收·測試 agent 寫紅)。
2. **派工提示要列「受保護的測試檔」**:`*.test.ts`、`features/steps/**`、Rust 的 tests 目錄、test-support、fixtures、`.feature`、向量檔。worker 覺得測試有錯,寫進報告的「待協調」,不改。驗收一律用「測試檔只能來自測試 agent 的 commit」比對(`git diff --name-only <基底>..HEAD`)。
3. **開發 worker 的起點分支由協調者組**:最新 origin/main + 測試 agent 的紅分支(+ 該票前置分支),在主 repo 開臨時 worktree 合好、驗過基底,再 fetch 進 workers clone;派工後驗 `git merge-base --is-ancestor origin/main HEAD`。
4. **R2(落點互斥)要把 review 狀態的工單也算進去**,不只 dispatched。落點含 `packages/contracts` 的工單不可同時進行。

### 重活規則(R3)與 load
5. **重活(整條鏈、cargo 編譯、cargo-mutants、Stryker、cucumber 全 feature、`tauri dev`/`build`)同一時間只准一個**,由協調者排位子:誰拿位子誰在完成時回「釋放」。位子順序寫進訊息,不靠默契。`-j`/`CARGO_BUILD_JOBS` 不是排程:2026-10-15 12:50 開發 worker 同時跑 24 個 cargo-mutants 行程,load 34,兩邊的測試都可能誤紅。
6. **開發 worker 不跑任何變異測試**(cargo-mutants、Stryker、`apps/desktop/src-tauri/run-mutants.mjs`、`npm run mutate`)——那是驗收者的。開發 worker 對 mutants 只剩一件事:把新 Rust 檔補進 `.cargo/mutants.toml` 的 examine_globs。
7. **所有 cargo、vitest、cucumber 指令前面加 `CARGO_BUILD_JOBS=2`**(vitest 與 cucumber 會重編 lc-fs)。重活期間,開發 worker 在 5 分鐘 load 平均超過 8 時先做不需編譯的部分(讀、寫程式、tsc、靜態測試)。
8. **load 高時量到的紅不當真紅**:先在低負載重跑再下判斷。

### 量測(唯一量法)
9. **learning/ 的量法只有這一個**(顧問 2026-10-15 裁決;`learning/` 底下有 `.git`,含 `.git` 的量法會因 git 操作而變;排序要固定語系):
   ```bash
   cd /data/python/llm_learning-cards/learning && LC_ALL=C find . -path ./.git -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16
   find . -path ./.git -prune -o -type f -print | wc -l        # 檔數(不含 .git)
   wc -l < state/log.jsonl                                     # 帳本行數
   ```
   **不寫死一個基準值**(顧問 2026-10-15 19:4x 裁決;帳本本來就會隨真呼叫與使用增長):**每次驗收前後各量一次,驗收期間三個數字必須完全相同**;帳本行數平時只能增加,而且只能在尾端追加,**變少、或中間的行被改了就是警報**。不一致時先確認「資料被動了」還是「量法不同」。舊值 168 / 959b2661…(含 .git)與 64 / 307b6f60…(沒設 LC_ALL)作廢。派工提示與證據只用這一個量法。
   **參考值(2026-10-15,golden run 與「故意改壞 prompt」實驗都結束之後重量):64 檔 / ee37f9e1fa9193c6 / 70 行**(之前是 64 / c5aa80b18b474ed4 / 52;差的 18 行 = golden run 15 次 + 改壞 prompt 實驗 3 次,全是尾端追加)。參考值會隨使用過時,不是門檻。
10. **指令偵測行程時,看 `/proc/<pid>/exe`,不要只比對 cmdline 字串**:Claude worker 的 cmdline 帶整段派工提示,會含「cargo」「mutants」等字,造成誤判;`orca-ide worktree ps | grep` 也會比中自己的命令字串。

### 驗證鏈(合併後)
11. **從全新簽出跑**:`git worktree add --detach <新目錄> <合併 commit>`,只用 `tar` 複製 `node_modules`(排除 `.vite`、`.vite-temp`、**`node_modules/node_modules`**——主簽出的 `node_modules` 裡有一條指回主簽出自己的絕對 symlink,複製進新簽出後,tsx 會載到主簽出的 esbuild,cucumber 轉 TypeScript 時報 `Internal error: Expected id 1 but got id 0`,`accept:standalone`、`accept:dry`、`check:dry-run`、`accept:coverage` 四步紅;2026-10-22 量到,拿掉那條就綠,vitest 與其他步驟不受影響),**不帶 `apps/desktop/src-tauri/target`**(啟動前 `ls` 確認不存在),`ls <目錄>/.env` 必須不存在。預檢先跑:`npx tsc --noEmit`、`npm run boundaries`、`npx tsx scripts/check-doc-links.ts`、`npx tsx scripts/check-adr-numbers.ts`,再 `CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 TEMPLATE_DIR=<釘 v1.6.8 的目錄> npm run check:all`,另跑 `env -u TEMPLATE_DIR npm run check:gates`。證據帶 host、核數、worker 數、起訖時間與 1/5/15 分 load、樹 sha 前後、porcelain、learning/ 前後(用上面的唯一量法)。
12. **只動文件的批次不重跑整條鏈,但預檢不能只挑幾個跑**:2026-10-15 17:0x 的文件批只動了 `features/` 與決策表,我跑了 doc-links、phase-status、standalone、`check:gates` 等,**漏了 next-gates**,於是 main 帶著紅推上去(14-hud-skin 的 NEXT.md 兩行格式不符),顧問與我都沒抓到。**只要批次碰到 `features/` 或 `docs/02-decision-map.md`,預檢就要跑完整的文件與規格守門**:`check-doc-links`、`check-next-gates`、`check-phase-status`、`check-phase-coverage`、`accept:dry`(dry-run)、`check-gherkin-dup`、`check-step-dup`、`check-adr-numbers`、`check-standalone`、`lint:docs`、`check:gates`;或者直接跑 `npm run check:all`。證據裡照實寫跑了哪些、沒跑哪些。**`check:gates` 不等於 next-gates**(前者是模板守門同步)。
13. **合併衝突照顧問裁決的那一版**,合併後 `git diff <合併前> HEAD -- <該檔>` 必須為空(確認真的是那一版),並讀過那個檔;`git merge` 沒報衝突不代表對(見 §4a)。
14. **單步驟確認**:多步驟指令用 `set -e` 或逐步確認,不要用長串 `&&` 把 `cd` 放在可能失敗的步驟之後(曾經把 node_modules 解回主目錄自己身上)。

### 文件與程式習慣
15. **doc-links**:文件(含工單、證據、報告)不要把「路徑:行號」放進反引號,寫成「路徑 第 N 行」純文字;反引號的相對路徑相對於文件所在目錄。送文件分支前先單跑 `npx tsx scripts/check-doc-links.ts`,紅了直接退回作者。
16. **改函式簽章時 `git grep` 所有呼叫端,包含 `.mjs`、`.js`**(tsc 不檢查它們):T5 改了 `strykerLockPath` 的簽章,`apps/desktop/src-tauri/run-mutants.mjs` 還傳字串,一跑就 TypeError。驗收清單也加這條。
17. **新增任何 `.ts` 要登記 `scripts/boundaries.owners.json`**,`npm run boundaries` 綠才交件。
18. **刪檔要連引用它的文件連結一起掃**(doc-links 守門會紅)。
19. **worker 不跑 `check:all` 時,收批前先跑 `npx tsc --noEmit`**。

### 用量與預算
20. **所有 worker 的 `$` 只記錄,不拿來煞車**(使用者 2026-10-15 16:4x 在顧問 session 親口說:「GROK不需要限額」):Claude(Max 訂閱,名目)、grok、opencode 一律如此。工單的 `budget_usd` 只是估計值,實際花費照樣記進證據(寫原值、模型、耗時、session id),但**不因為超過預算而 interrupt**。**Claude worker 仍有額度停止線**(那是共用額度,不是預算):`7d` 比開工漲超過 3 個百分點,或 `5h` 超過 80%,立刻停。驗收證據照舊寫「花費 / 預算 = 幾倍」供使用者知道,不當作退回理由。
21. **開發 worker 預設用 opencode + grok-4.7**(「暫停派 grok」已解除);grok 卡住、做不完(像 T5)時改派 Claude 接手。**已經開工的 worker 不中途換。**opencode 的對話在背景服務,關 TUI 不會停;**重開 opencode 之前先 `opencode api GET /api/session/active`**,避免同一個 worktree 同時跑兩個對話(那是重複做工,不是限額);停用 `opencode api POST /api/session/{id}/interrupt`。解析 `opencode session export <id>` 要用 `python3 -I`(輸出前綴不是 JSON)。
22. **`--live` 煞車 2026-10-15 19:3x 解除**(依據:T1 花費煞車、T5 帳本跨 clone 只有一本且驗身分、T8 壞行算「不知道」而拒絕真呼叫、T9 每一行都要符合 schema,加上 4df31b8 上的三項檢查全綠;顧問宣布)。**已知限制**:T10(逾時、重試、截斷那幾行會低估,每筆最多幾美分,優先度低);`.env` 的 `LLM_DAILY_CAP_USD` 每個簽出各一份(只有主簽出有 `.env`,worker 的簽出沒有憑證)。**真呼叫只在主簽出跑**,跑前、跑後各記一次 `npx tsx scripts/llm-spend.ts --today`;`llm-spend` 回 exit 1(到上限)或 exit 2(不知道)就停,**不重試**。解除不等於自動跑:每一次真呼叫都要有明確的工作理由(例如 golden run),並把花費寫進證據。第一次真呼叫:12-prompt-quality golden run,15 次、約 US$0.0919;同日另有「故意改壞 prompt」實驗 3 次、約 US$0.0238;**當日合計 18 次、US$0.1157**(`llm-spend --today` 最終輸出)。

### 合併後的收尾
23. **收 worker 要三件加四邊**(見 §4f):porcelain 0、HEAD 已在 origin/main 或已另存成分支、畫面閒置無進行中工作;刪後目錄、`git worktree list`、分支、行程都不在。
24. **一輪只合一條就通知一次**;送出「請驗推」後 main 凍結到顧問回「已推」或「退回」。

### 交件前(2026-10-15,顧問)
25. **不准用 `git add -A`、`git add .`、`git commit -a`**:一律寫明要加的路徑。**交件前跑 `git diff --stat <基底>..HEAD`(也看 `git diff --name-only <基底> HEAD | sed 's#/[^/]*$##' | sort | uniq -c | sort -rn | head`),檔數與目錄分佈和預期不符就停下來。** 實例:T2c-2 驗收分支一個 `git add -A` 把 cargo-mutants 的輸出整包(`mutants.out/`,329 個檔)commit 進去,協調者合併後才由檔數量到;`.gitignore` 補上之後,**歷史裡仍有那 329 個檔**,最後由驗收者改寫自己的分支(該分支尚未推出)才乾淨。驗收「沒有某些檔」要看整段歷史:`git log --name-only <基底>..<tip> | grep -c <樣式>` 為 0,不能只看最後的樹。上游 dev-paradigm 也踩過(230337b「誤掃進版控的 580 個檔」)。**合併別人的分支之前先量檔案數與目錄分佈,再看測試結果。**

26. **真呼叫的證據,花費與次數一律取 `llm-spend --today` 的最終輸出,而且要在「所有」真呼叫都結束後才量**(顧問 2026-10-15 19:5x):分階段回報時每一段都寫明「截至何時、含哪些呼叫」;**重跑、追加的實驗要單獨列**(次數、花費、時間範圍),不能讓早先回報的總數看起來就是最後的總數。實例:golden run 15 次 $0.0919 回報之後,又做了改壞 prompt 的 3 次 $0.0238,帳本變成 18 次 $0.1157;早先那則只含前半段,顧問量到帳本時看起來像「多出 3 筆」。對帳方法:帳本最後 N 行的 ts 與 tokens 加總要能對上每一次指令的輸出(本例 11:19:40–11:21:19 共 15 行是 golden run,11:24:05–11:24:20 共 3 行是實驗,tokens 進 1606 出 1979 與實驗輸出一致)。

### 工單檔頭與模板(2026-10-22,T39 合併後)
27. **工單檔頭的 `status` 由協調者在「同一批 main commit」裡維護**(13-work-dag phase-2 起,`dag:check` 會紅):新工單一定要有檔頭(`id`、`deps`、`touches`、`cpu`、`status`、`owner`,格式見 `features/13-work-dag/FEATURE.md`);派工 → `dispatched`、送審 → `review`、合併 → `merged`、放棄 → `dropped`。狀態改動跟著對應的 main 批次一起 commit,不要事後補;合併後與派工前各跑一次 `npx tsx scripts/dag.ts --root .` 看 `problems=0`。**工單檔頭的 status 現在是 dag 測試的輸入**(2026-10-23,c9ba0b5 把 T39 標 merged 後 `scripts/dag-check.test.ts` 有一條寫死 T39 在進行中而紅,推上去才發現):**動到工單檔頭的批次,推之前要跑 `npx vitest run scripts/dag.test.ts scripts/dag-check.test.ts`**,跟設定 JSON 一樣不算「只動文件」。
28. **模板 repo 的路徑是 `/data/python/dev-loop-mcp`**(2026-10-23 使用者答覆:舊的 `/data/python/dev-paradigm` 是舊版、他刪的;新版是同一個 git repo 改名延續,歷史與 tag 都在,`v1.6.8` = `88a3e11`)。`scripts/check-gates-pinned.sh` 的 `TEMPLATE_REPO` 預設已改成這個路徑,不設任何變數的 `npm run check:gates` 即可。釘版模板:`git -C /data/python/dev-loop-mcp archive v1.6.8 | tar -x -C <目錄>`。垃圾桶裡那份(`/data/.Trash-1000/files/dev-paradigm`)不要再用。專案要不要從 v1.6.8 升到 dlm 是另一件事,現在不動。
29. **UI 工單只要有「使用者看得到的狀態轉換」,紅測試就要真的渲染,不收原始碼字串比對**(顧問 2026-10-24 裁決):T43 的視窗層測試對 `App.svelte` 只比原始碼字串,整鏈 243 檔全綠,`@manual` 卻發現按「深入這個」後整段生成(18–27 秒)畫面完全不變(沒有「正在產生…」、沒有取消、按鈕沒停用),因為畫面只在 `act()` 的 promise 結束時更新(F1,另引出 F2:生成中按「下一個」跳出錯誤畫面)。工單的驗收條件要點名「哪幾個畫面狀態要被真渲染的測試看到」(用 `packages/ui-shared/src/hud/render-test-support.ts` 的 `openApp` 加假的慢 client 或等價做法,不新增 npm 依賴),驗收者核紅測試時要確認它在基底上真的紅,而不是只在原始碼裡找到字串。

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
