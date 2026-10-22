# T39 重測後仍存活者逐隻清單(第二輪補測用)

- 重測:t39-verify 4baf6832ceda22bc6e5ccb20e1de22bb8897b72e(= t39-impl-2 0a1170f + t39-red-2 b8ce744),設定檔 stryker.t39-dag-rerun.json,398 隻:殺 294、存活 104、逾時 0。
- 行號是 t39-verify 的 scripts/dag.ts(含 50 條 Stryker 註解);「舊行」是 t39-impl b91bd03 的行號,對照 acceptance-T39-survivors.md。
- 新分數:(845 + 新殺 91) / (1111 − 等價 72) = 936/1039 = 90.09%。但必補 174 只殺了 91,**剩 83 隻必補**,另有可低 20 隻、等價 1 隻(1093:85,未加註解)。
- 顧問彈性:某隻只能用「為殺而殺」的斷言殺死(問「程式真這樣壞,使用者會遇到什麼」答不出真行為),可改列可低並逐隻寫一行理由;超過 10 隻停下來交顧問。
- 補測只新增、不改不刪既有斷言。測試建議欄就是要補的情境。

| 類 | 隻數 |
|---|---|
| 必補(仍存活) | 83 |
| 可低 | 20 |
| 等價(未加註解) | 1 |

## 逐隻

| 新行:欄 | 舊行 | 函式 | mutator | 替換(截 60 字) | 分類 | 該怎麼測 |
|---|---|---|---|---|---|---|
| 695:7 | 688 | parseHeaderText | MethodExpression | lines[0] ?? '' | 必補 | 補:首行「--- 」前後帶空白仍算有檔頭 |
| 700:19 | 692 | parseHeaderText | EqualityOperator | i <= lines.length | 必補 | 補:檔頭開了沒有收尾的「---」。邊界改成 <= 時 lines[length] 為 undefined,.trim() 丟例外 |
| 701:9 | 693 | parseHeaderText | MethodExpression | lines[i]! | 必補 | 補:收尾的「---」後面帶空白,以及檔頭內的空行不可被當成收尾 |
| 712:10 | 704 | parseHeaderText | EqualityOperator | idx <= end | 必補 | 補:檔頭開了沒有收尾的「---」。邊界改成 <= 時 lines[length] 為 undefined,.trim() 丟例外 |
| 714:9 | 706 | parseHeaderText | MethodExpression | raw | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 719:26 | 711 | parseHeaderText | ConditionalExpression | true | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 725:16 | 717 | parseHeaderText | Regex | /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/ | 可低 | 去掉 $ 後只有行內含 \r 或 U+2028 這類行終止字元時才不同,檔頭行不會有;不能嚴格證明所以不列等價 |
| 725:16 | 717 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\S*:\s*(.*)$/ | 可低 | 去掉 $ 後只有行內含 \r 或 U+2028 這類行終止字元時才不同,檔頭行不會有;不能嚴格證明所以不列等價 |
| 725:16 | 717 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\s*:\S*(.*)$/ | 可低 | 去掉 $ 後只有行內含 \r 或 U+2028 這類行終止字元時才不同,檔頭行不會有;不能嚴格證明所以不列等價 |
| 725:16 | 717 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)/ | 可低 | 去掉 $ 後只有行內含 \r 或 U+2028 這類行終止字元時才不同,檔頭行不會有;不能嚴格證明所以不列等價 |
| 725:61 | 717 | parseHeaderText | MethodExpression | stripKeyComment(raw) | 必補 | 補:縮排的 key 行(例如「  id: T1」)要照常解析(.trim() 負責去前導空白) |
| 762:16 | 749 | parseHeaderText | ConditionalExpression | true | 必補 | 補:id 缺漏、id 重複或不合法時,PROBLEM 行用檔名當名字,不是 id |
| 763:24 | 750 | parseHeaderText | ConditionalExpression | true | 必補 | 補:id 缺漏時 PROBLEM 行的名字是檔名,不是 undefined |
| 799:12 | 782 | parseHeaderText | Regex | /^\d+(\.\d)?$/ | 必補 | 補:budget_usd 寫「0.25」「1.5」要過、「1abc」「.5」「1.」要 invalid |
| 839:33 | 815 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 849:28 | 822 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 853:44 | 825 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 854:37 | 826 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 860:12 | 832 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 內容不是合法 JSON 時回空表 |
| 869:77 | 840 | resolveTouch | EqualityOperator | prefix.length >= best.len | 必補 | 補:owners 有兩列同長度前綴時誰贏(目前是先到者) |
| 886:18 | 857 | infraShared | StringLiteral | "" | 必補 | 補:b 不是目錄(結尾沒有 /)時,a 以 b 開頭不算共用(例如 scripts/a.ts 與 scripts/a.ts.bak);兩個方向各一條 |
| 916:11 | 885 | phaseStatusMap | ConditionalExpression | true | 必補 | 補:同一個 phase 在表裡出現兩次時先到者為準 |
| 940:48 | 908 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 940:48 | 908 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 940:48 | 908 | classifyDep | LogicalOperator | r.kind === 'phase' ¦¦ r.raw === raw | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 940:70 | 908 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 941:16 | 909 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 942:9 | 910 | classifyDep | ConditionalExpression | false | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 942:39 | 910 | classifyDep | ObjectLiteral | {} | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 944:9 | 912 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 944:9 | 912 | classifyDep | LogicalOperator | folder !== null ¦¦ tables.get(folder)?.has(phase.num) | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 944:28 | 912 | classifyDep | OptionalChaining | tables.get(folder).has | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 965:7 | 929 | loadTicketNodes | ConditionalExpression | false | 必補 | 補:docs/tickets 是一般檔案(不是目錄)時回空結果、不丟例外 |
| 965:33 | 929 | loadTicketNodes | ObjectLiteral | {} | 必補 | 補:docs/tickets 是一般檔案(不是目錄)時回空結果、不丟例外 |
| 967:22 | 931 | loadTicketNodes | MethodExpression | readdirSync(dir) | 可低 | 只改 tickets Map 的插入順序;輸出行都在 augment 排過序,但沒證明每條路徑都與順序無關,不列等價 |
| 967:22 | 931 | loadTicketNodes | MethodExpression | readdirSync(dir).filter(n => n.endsWith('.md')) | 可低 | 只改 tickets Map 的插入順序;輸出行都在 augment 排過序,但沒證明每條路徑都與順序無關,不列等價 |
| 967:64 | 931 | loadTicketNodes | StringLiteral | "" | 必補 | 補:docs/tickets 裡有非 .md 的檔(例如 notes.txt)要被忽略 |
| 975:9 | 939 | loadTicketNodes | ConditionalExpression | false | 必補 | 補:docs/tickets 裡有名叫 x.md 的目錄要略過 |
| 1003:9 | 967 | wireDeps | Regex | /I\d+$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」(同 classifyDep 906) |
| 1006:12 | 970 | wireDeps | ConditionalExpression | true | 必補 | 補:phase 形式的依賴:phase 狀態 done 才算滿足,其他狀態(todo、in-progress、blocked)不滿足 |
| 1030:14 | 994 | compareRecord | Regex | /PROBLEM bad-header (\S+) (missing¦invalid) (\S+)$/ | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1030:14 | 994 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S+)/ | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1031:14 | 995 | compareRecord | Regex | /PROBLEM bad-header (\S+) (missing¦invalid) (\S+)$/ | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1031:14 | 995 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S+)/ | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1035:9 | 999 | compareRecord | ConditionalExpression | true | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1035:27 | 999 | compareRecord | ArithmeticOperator | ia + ib | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:9 | 1000 | compareRecord | ConditionalExpression | false | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:9 | 1000 | compareRecord | ConditionalExpression | true | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:9 | 1000 | compareRecord | EqualityOperator | pa[2] === pb[2] | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:33 | 1000 | compareRecord | ConditionalExpression | false | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:33 | 1000 | compareRecord | ConditionalExpression | true | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:33 | 1000 | compareRecord | EqualityOperator | pa[2] !== 'missing' | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:43 | 1000 | compareRecord | StringLiteral | "" | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1036:55 | 1000 | compareRecord | UnaryOperator | +1 | 必補 | 補:(a) 同一張工單 cpu 與 budget_usd 同時不合法:HEADER_FIELDS 順序 cpu(3) 在 budget_usd(4) 前,字串自然序卻是 budget_usd 在前,輸出必須 cpu 在前;(b) 兩個檔共用同一個 id、一個缺 cpu 一個 cpu 不合法,missing 在 invalid 前;(c) 名字要多字元(T5、T10),單字元名字測不出 regex 的 \S+ |
| 1047:9 | 1011 | makeDepth | ConditionalExpression | false | 可低 | 去掉記憶化只在圖有環時結果不同(環已是 PROBLEM),無環圖只差效能;有環時不能嚴格證明所以不列等價 |
| 1055:5 | 1018 | makeDepth | CallExpression | ; | 可低 | 去掉記憶化只在圖有環時結果不同(環已是 PROBLEM),無環圖只差效能;有環時不能嚴格證明所以不列等價 |
| 1065:9 | 1028 | augment | Regex | /I\d+$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」 |
| 1065:9 | 1028 | augment | Regex | /^I\d$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」 |
| 1068:12 | 1031 | augment | ConditionalExpression | true | 必補 | 補:R5 深度:未完成的 phase 依賴要算進深度(phase 狀態 done 才當滿足);phase 鏈上疊 5 層要出 WARN r5-depth |
| 1084:32 | 1047 | augment | MethodExpression | ticket.resolved | 必補 | 補:todo 工單依賴「別張工單加一個 phase」且與別張成環時,環要被偵測 |
| 1089:22 | 1052 | augment | MethodExpression | extra | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1089:35 | 1052 | augment | ArrowFunction | () => undefined | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1089:42 | 1052 | augment | MethodExpression | l.endsWith('PROBLEM cycle ') | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1089:55 | 1052 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1090:24 | 1053 | augment | MethodExpression | text | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1090:35 | 1053 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1090:66 | 1053 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1090:75 | 1053 | augment | CallExpression | ; | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1134:85 | 1093 | augment | ConditionalExpression | true | 等價(未加註解) | against 只由 occupying(dispatched/review)與 selected 組成,括號內三個條件對 against 的每個元素恆為真,改成 true 沒有差別;這一行有同 mutator 的必補(16 欄),所以沒加註解,留在存活區 |
| 1136:35 | 1095 | augment | ConditionalExpression | false | 必補 | 補:只有 R3 衝突(沒有 R2、沒有 R4)時工單仍是 HELD、不 START;只有 R2 時同理 |
| 1147:36 | 1106 | augment | MethodExpression | phase.lines | 必補 | 補:phase 的 START/HELD 只對 READY 的 phase 發,BLOCKED、blocked、done 的 phase 不發 |
| 1147:75 | 1106 | augment | StringLiteral | "" | 必補 | 補:phase 的 START/HELD 只對 READY 的 phase 發,BLOCKED、blocked、done 的 phase 不發 |
| 1154:49 | 1113 | augment | MethodExpression | phase.edges | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1154:68 | 1113 | augment | ArrowFunction | () => undefined | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1154:80 | 1113 | augment | ConditionalExpression | false | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1154:80 | 1113 | augment | ConditionalExpression | true | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1154:80 | 1113 | augment | EqualityOperator | to !== node | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1154:97 | 1113 | augment | ArrowFunction | () => undefined | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1177:16 | 1132 | augment | ConditionalExpression | true | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1184:9 | 1139 | augment | ConditionalExpression | false | 必補 | 補:同一條邊同時來自 phase 與工單時只輸出一次 |
| 1185:5 | 1140 | augment | CallExpression | ; | 必補 | 補:同一條邊同時來自 phase 與工單時只輸出一次 |
| 1196:78 | 1151 | augment | StringLiteral | "" | 必補 | 補:HUMAN 行的條數寫進摘要行的 human=;有 HUMAN 行的假樹逐字比對 |
| 1211:109 | 1165 | orcaScript | ConditionalExpression | true | 可低 | 工單依賴自己的情況(自環,已是 PROBLEM cycle) |
| 1223:13 | 1177 | orcaScript | BooleanLiteral | preds.get(ticket.id)!.includes(id) | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1223:13 | 1177 | orcaScript | ConditionalExpression | false | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1223:13 | 1177 | orcaScript | ConditionalExpression | true | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1224:22 | 1178 | orcaScript | ArithmeticOperator | (indeg.get(ticket.id) ?? 0) + 1 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1224:23 | 1178 | orcaScript | LogicalOperator | indeg.get(ticket.id) && 0 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1225:9 | 1179 | orcaScript | CallExpression | ; | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1226:13 | 1180 | orcaScript | ConditionalExpression | false | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1226:13 | 1180 | orcaScript | ConditionalExpression | true | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1226:13 | 1180 | orcaScript | EqualityOperator | left !== 0 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1226:25 | 1180 | orcaScript | CallExpression | ; | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1231:63 | 1185 | orcaScript | ArrowFunction | () => undefined | 可低 | 有環的工單(不在任何一輪解鎖)接在最後依 id 自然排序輸出;環已是 PROBLEM |
| 1231:91 | 1185 | orcaScript | CallExpression | ; | 可低 | 有環的工單(不在任何一輪解鎖)接在最後依 id 自然排序輸出;環已是 PROBLEM |
| 1234:10 | 1187 | orcaScript | ConditionalExpression | false | 可低 | 沒有 todo 工單時 --orca 輸出空字串(不是換行);字樣排版 |
| 1234:31 | 1187 | orcaScript | StringLiteral | "Stryker was here!" | 可低 | 沒有 todo 工單時 --orca 輸出空字串(不是換行);字樣排版 |
| 1253:21 | 1206 | parseFlags | MethodExpression | value.endsWith('-') | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1254:11 | 1207 | parseFlags | ConditionalExpression | false | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1254:26 | 1207 | parseFlags | CallExpression | ; | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1289:21 | 1239 | invokedAsCli | MethodExpression | process.argv | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1290:9 | 1240 | invokedAsCli | ConditionalExpression | false | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1290:9 | 1240 | invokedAsCli | LogicalOperator | !arg && arg.startsWith('-') | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1290:17 | 1240 | invokedAsCli | MethodExpression | arg.endsWith('-') | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
