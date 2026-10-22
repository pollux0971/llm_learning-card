# T39 變異存活者逐隻清單(266 隻)

- 被驗:t39-impl b91bd0354b751f942b71477c606c8df5d3498adf 的 scripts/dag.ts;行號與欄號就是這個版本的(加註解後行號會移動)。
- 變異跑法與分數見 acceptance-T39.md 第 5 節:1111 隻,殺 845,存活 266,76.06%。
- 來源:變異報告 JSON 的逐隻資料;「替換」欄截到 60 字,行與欄是完整的。報告 JSON 原檔在清理驗收 worktree 時一併刪掉了(只有 15 行摘要進版控),這份清單是在那之前抽出來的。
- 分類(顧問 2026-10-22 的三類標準):
  - 必補:工單範圍內,存活代表真缺口或邊界沒被釘住。「理由/要補的測試」欄寫要補什麼。
  - 可低:留著、仍算分母(用法訊息、CLI 殼、字樣排版,以及我無法嚴格證明等價的幾隻)。
  - 等價:附「為什麼行為一樣」。逐隻等價清單另放 acceptance-T39-equivalents.md。

## 總數

| 類 | 隻數 |
|---|---|
| 必補 | 174 |
| 可低 | 20 |
| 等價 | 72 |
| 合計 | 266 |

照顧問的收法算:(845 + 新殺) / (1111 − 等價 72) = 起點 845/1039 = 81.3%;必補 174 隻全殺後是 98.1%。等價清單由協調者加註解、我核對後才成立,在那之前以 76.06% 為準。

## 各函式

| 函式 | 必補 | 可低 | 等價 |
|---|---|---|---|
| augment | 52 | 0 | 9 |
| parseHeaderText | 37 | 1 | 22 |
| compareRecord | 26 | 4 | 0 |
| loadLandings | 12 | 0 | 5 |
| orcaScript | 11 | 5 | 1 |
| classifyDep | 13 | 0 | 0 |
| overlapReasons | 0 | 0 | 13 |
| loadTicketNodes | 7 | 1 | 4 |
| parseInlineList | 6 | 0 | 3 |
| wireDeps | 7 | 0 | 0 |
| invokedAsCli | 0 | 4 | 0 |
| scalarUnsupported | 0 | 0 | 4 |
| main | 0 | 0 | 3 |
| makeDepth | 0 | 2 | 1 |
| parseFlags | 0 | 3 | 0 |
| stripKeyComment | 0 | 0 | 3 |
| phaseTables | 0 | 0 | 2 |
| resolveTouch | 1 | 0 | 1 |
| infraShared | 1 | 0 | 0 |
| orcaLine | 0 | 0 | 1 |
| phaseStatusMap | 1 | 0 | 0 |

## 逐隻

| 行:欄 | 函式 | mutator | 替換(截 60 字) | 分類 | 理由/要補的測試 |
|---|---|---|---|---|---|
| 664:13 | stripKeyComment | Regex | /(?:\s)#/ | 等價 | 行首 # 那一支永遠走不到:呼叫它之前第 706 行已把「第一個非空白字元是 #」的行整行略過,只剩「空白加 #」有作用 |
| 665:18 | stripKeyComment | MethodExpression | line.trimStart() | 等價 | 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串 |
| 666:10 | stripKeyComment | MethodExpression | line.slice(0, m.index).trimStart() | 等價 | 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串 |
| 670:7 | parseInlineList | LogicalOperator | !value.startsWith('[') && !value.endsWith(']') | 必補 | 補:inline 清單缺左括號、缺右括號各一條,都要回 null(欄位 invalid) |
| 670:25 | parseInlineList | StringLiteral | "" | 必補 | 補:inline 清單缺左括號、缺右括號各一條,都要回 null(欄位 invalid) |
| 670:49 | parseInlineList | StringLiteral | "" | 必補 | 補:inline 清單缺左括號、缺右括號各一條,都要回 null(欄位 invalid) |
| 673:7 | parseInlineList | ConditionalExpression | false | 等價 | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 673:7 | parseInlineList | MethodExpression | inner | 等價 | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 673:24 | parseInlineList | StringLiteral | "Stryker was here!" | 等價 | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 674:10 | parseInlineList | MethodExpression | inner.split(',').map(s => s.trim()) | 必補 | 補:「[a,,b]」「[ a , b ]」要得到 [a,b](去空白、濾空字串) |
| 674:62 | parseInlineList | ConditionalExpression | true | 必補 | 補:「[a,,b]」「[ a , b ]」要得到 [a,b](去空白、濾空字串) |
| 674:68 | parseInlineList | StringLiteral | "Stryker was here!" | 必補 | 補:「[a,,b]」「[ a , b ]」要得到 [a,b](去空白、濾空字串) |
| 677:52 | scalarUnsupported | BlockStatement | {} | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:10 | scalarUnsupported | ConditionalExpression | false | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:10 | scalarUnsupported | LogicalOperator | /['"{}\[\]¦]/.test(value) && value.startsWith('>') | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:39 | scalarUnsupported | MethodExpression | value.endsWith('>') | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 688:7 | parseHeaderText | MethodExpression | lines[0] ?? '' | 必補 | 補:首行「--- 」前後帶空白仍算有檔頭 |
| 688:20 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | lines[0] 一定存在(split 至少回一個元素),?? 的預設值走不到 |
| 689:43 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | 等價 | missingHeader 為 true 時 loadTicketNodes 只印 missing-header 然後 continue,不讀 issues |
| 692:19 | parseHeaderText | EqualityOperator | i <= lines.length | 必補 | 補:檔頭開了沒有收尾的「---」。邊界改成 <= 時 lines[length] 為 undefined,.trim() 丟例外 |
| 693:9 | parseHeaderText | MethodExpression | lines[i]! | 必補 | 補:收尾的「---」後面帶空白,以及檔頭內的空行不可被當成收尾 |
| 693:30 | parseHeaderText | StringLiteral | "" | 必補 | 補:收尾的「---」後面帶空白,以及檔頭內的空行不可被當成收尾 |
| 704:10 | parseHeaderText | EqualityOperator | idx <= end | 必補 | 補:檔頭開了沒有收尾的「---」。邊界改成 <= 時 lines[length] 為 undefined,.trim() 丟例外 |
| 706:9 | parseHeaderText | ConditionalExpression | false | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:9 | parseHeaderText | ConditionalExpression | false | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:9 | parseHeaderText | LogicalOperator | raw.trim() === '' && /^\s*#/.test(raw) | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:9 | parseHeaderText | MethodExpression | raw | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:24 | parseHeaderText | StringLiteral | "Stryker was here!" | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:30 | parseHeaderText | Regex | /^\S*#/ | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:30 | parseHeaderText | Regex | /^\s#/ | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 706:49 | parseHeaderText | BlockStatement | {} | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 707:7 | parseHeaderText | UpdateOperator | idx-- | 必補 | 補:檔頭中的空行與整行 # 註解要略過(尤其夾在 block 清單的兩個項目之間不可中斷清單) |
| 711:9 | parseHeaderText | ConditionalExpression | false | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 711:9 | parseHeaderText | EqualityOperator | item === null | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 711:26 | parseHeaderText | ConditionalExpression | true | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 711:46 | parseHeaderText | BlockStatement | {} | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 712:7 | parseHeaderText | CallExpression | ; | 必補 | 補:block 清單(deps: 換行 - X)的項目要進清單,不在清單狀態的「- X」行不可併入 |
| 717:16 | parseHeaderText | Regex | /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/ | 必補 | 補:「- id: T1」「xx id: T1」這類不是行首 key 的行不可當作 key |
| 717:16 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\S*:\s*(.*)$/ | 必補 | 補:「id : T1」「id :T1」(冒號前後有空白)要照常解析 |
| 717:16 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\s*:\S*(.*)$/ | 必補 | 補:「id : T1」「id :T1」(冒號前後有空白)要照常解析 |
| 717:16 | parseHeaderText | Regex | /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)/ | 可低 | 去掉 $ 後只有行內含 \r 或 U+2028 這類行終止字元時才不同,檔頭行不會有;不能嚴格證明所以不列等價 |
| 717:61 | parseHeaderText | MethodExpression | stripKeyComment(raw) | 必補 | 補:縮排的 key 行(例如「  id: T1」)要照常解析(.trim() 負責去前導空白) |
| 718:9 | parseHeaderText | ConditionalExpression | false | 必補 | 補:檔頭中非 key: value 的雜訊行要略過,不可丟例外或卡住 |
| 718:14 | parseHeaderText | BlockStatement | {} | 必補 | 補:檔頭中非 key: value 的雜訊行要略過,不可丟例外或卡住 |
| 719:7 | parseHeaderText | UpdateOperator | idx-- | 必補 | 補:檔頭中非 key: value 的雜訊行要略過,不可丟例外或卡住 |
| 723:19 | parseHeaderText | MethodExpression | km[2] ?? '' | 等價 | 呼叫端已把整行 trim,且正則 \s* 吃掉冒號後的空白、(.*) 貪婪到行尾,km[2] 不會有頭尾空白 |
| 723:29 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | (.*) 一定有參與匹配,km[2] 不會是 undefined,?? 的預設值走不到 |
| 725:9 | parseHeaderText | ConditionalExpression | false | 等價 | 不在 HEADER_FIELDS 的 key 只寫進 seen/scalars/bad,之後只用 HEADER_FIELDS 的名字去讀,多寫不影響輸出 |
| 726:9 | parseHeaderText | ConditionalExpression | false | 必補 | 補:同一個 key 出現兩次要標 invalid(重複鍵) |
| 726:24 | parseHeaderText | BlockStatement | {} | 必補 | 補:同一個 key 出現兩次要標 invalid(重複鍵) |
| 727:7 | parseHeaderText | CallExpression | ; | 必補 | 補:同一個 key 出現兩次要標 invalid(重複鍵) |
| 732:25 | parseHeaderText | BlockStatement | {} | 必補 | 補:block 清單的欄位(deps: 後換行)要建空清單並進入清單狀態 |
| 740:16 | parseHeaderText | ConditionalExpression | false | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:16 | parseHeaderText | LogicalOperator | scalarUnsupported(value) && value === '' | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:44 | parseHeaderText | ConditionalExpression | false | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:54 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:58 | parseHeaderText | BlockStatement | {} | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 741:7 | parseHeaderText | CallExpression | ; | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 742:7 | parseHeaderText | CallExpression | ; | 等價 | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 749:16 | parseHeaderText | ConditionalExpression | true | 必補 | 補:id 缺漏、id 重複或不合法時,PROBLEM 行用檔名當名字,不是 id |
| 749:16 | parseHeaderText | ConditionalExpression | true | 必補 | 補:id 缺漏、id 重複或不合法時,PROBLEM 行用檔名當名字,不是 id |
| 749:16 | parseHeaderText | LogicalOperator | idRaw !== undefined | 必補 | 補:id 缺漏、id 重複或不合法時,PROBLEM 行用檔名當名字,不是 id |
| 749:48 | parseHeaderText | StringLiteral | "" | 必補 | 補:id 缺漏、id 重複或不合法時,PROBLEM 行用檔名當名字,不是 id |
| 750:24 | parseHeaderText | ConditionalExpression | true | 必補 | 補:id 缺漏時 PROBLEM 行的名字是檔名,不是 undefined |
| 766:39 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 771:42 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 776:41 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 781:46 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 782:12 | parseHeaderText | Regex | /^\d+(\.\d)?$/ | 必補 | 補:budget_usd 寫「0.25」「1.5」要過、「1abc」「.5」「1.」要 invalid |
| 782:12 | parseHeaderText | Regex | /^\d+(\.\d+)?/ | 必補 | 補:budget_usd 寫「0.25」「1.5」要過、「1abc」「.5」「1.」要 invalid |
| 786:47 | parseHeaderText | StringLiteral | "Stryker was here!" | 等價 | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 790:37 | parseHeaderText | ConditionalExpression | false | 等價 | issues 為空時 id 欄位一定通過 idOk(否則 id 欄位早已進 issues),所以 !idOk 與 idRaw===undefined 恆為 false,多餘的防護 |
| 800:34 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | 等價 | deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到 |
| 801:40 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | 等價 | deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到 |
| 802:13 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | 等價 | hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀 |
| 804:21 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | 等價 | hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀 |
| 815:7 | loadLandings | ConditionalExpression | false | 等價 | existsSync 為假時往下的 statSync 會丟例外,被 catch 回 [],結果相同 |
| 815:33 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 819:11 | loadLandings | BlockStatement | {} | 等價 | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 820:12 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 等價 | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 822:7 | loadLandings | ConditionalExpression | false | 等價 | 路徑是目錄時往下的 readFileSync 丟 EISDIR,被 catch 回 [],結果相同 |
| 822:28 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 825:9 | loadLandings | ConditionalExpression | false | 等價 | owners 不是陣列時 for-of 對 undefined/物件/數字丟 TypeError(被 catch 回 []),對字串逐字走訪但每個字都不是陣列列而被略過,結果都是 [] |
| 825:44 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 826:37 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 缺檔、是目錄、owners 不是陣列、正常載入各一條,且用大寫 S 開頭的 touch 確認沒有多出假列 |
| 828:11 | loadLandings | ConditionalExpression | true | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 828:11 | loadLandings | ConditionalExpression | true | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 828:11 | loadLandings | LogicalOperator | Array.isArray(row) && typeof row[0] === 'string' | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 828:11 | loadLandings | LogicalOperator | Array.isArray(row) | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 828:33 | loadLandings | ConditionalExpression | true | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 828:63 | loadLandings | ConditionalExpression | true | 必補 | 補:owners 裡有格式不對的列(非陣列、缺欄、欄位不是字串)要被略過,好列保留 |
| 831:11 | loadLandings | BlockStatement | {} | 必補 | 補:owners.json 內容不是合法 JSON 時回空表 |
| 832:12 | loadLandings | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:owners.json 內容不是合法 JSON 時回空表 |
| 840:10 | resolveTouch | ConditionalExpression | false | 等價 | touch===prefix 蘊含 touch.startsWith(prefix),左邊那一支是重複條件 |
| 840:77 | resolveTouch | EqualityOperator | prefix.length >= best.len | 必補 | 補:owners 有兩列同長度前綴時誰贏(目前是先到者) |
| 857:18 | infraShared | StringLiteral | "" | 必補 | 補:b 不是目錄(結尾沒有 /)時,a 以 b 開頭不算共用(例如 scripts/a.ts 與 scripts/a.ts.bak);兩個方向各一條 |
| 864:24 | overlapReasons | MethodExpression | [...b.landings] | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | LogicalOperator | l !== 'infra' | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:60 | overlapReasons | StringLiteral | "" | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:71 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:77 | overlapReasons | StringLiteral | "" | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | LogicalOperator | l !== 'infra' | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:15 | overlapReasons | StringLiteral | "" | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:26 | overlapReasons | ConditionalExpression | true | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:32 | overlapReasons | StringLiteral | "" | 等價 | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 885:11 | phaseStatusMap | ConditionalExpression | true | 必補 | 補:同一個 phase 在表裡出現兩次時先到者為準 |
| 895:9 | phaseTables | ConditionalExpression | false | 等價 | 節點名由 nodeName 組成,一定含「/phase-」且資料夾名非空,slash 不會小於等於 0 |
| 895:9 | phaseTables | EqualityOperator | slash <= 0 | 等價 | 節點名由 nodeName 組成,一定含「/phase-」且資料夾名非空,slash 不會小於等於 0 |
| 906:7 | classifyDep | Regex | /I\d+$/ | 必補 | 補:I 閘門的錨點:「I4」是閘門、「I10」是閘門、「XI4」「I4x」不是 |
| 906:7 | classifyDep | Regex | /^I\d$/ | 必補 | 補:I 閘門的錨點:「I4」是閘門、「I10」是閘門、「XI4」「I4x」不是 |
| 906:7 | classifyDep | Regex | /^I\d+/ | 必補 | 補:I 閘門的錨點:「I4」是閘門、「I10」是閘門、「XI4」「I4x」不是 |
| 908:48 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 908:48 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 908:48 | classifyDep | LogicalOperator | r.kind === 'phase' | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 908:70 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 909:16 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 910:9 | classifyDep | ConditionalExpression | false | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 910:39 | classifyDep | ObjectLiteral | {} | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 912:9 | classifyDep | ConditionalExpression | true | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 912:9 | classifyDep | LogicalOperator | folder !== null | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 912:28 | classifyDep | OptionalChaining | tables.get(folder).has | 必補 | 補:依賴寫成「13-work-dag/phase-1」這種 phase 形式時的解析:資料夾不存在、phase 不存在回 unresolved,存在回節點;含非 phase 形式字串 |
| 919:30 | loadTicketNodes | ArrayDeclaration | ["Stryker was here"] | 等價 | augment 的 take() 只收 LINE_KINDS 開頭的行,「Stryker was here」的 kind 不在其中,被丟掉,不進輸出也不計數 |
| 922:7 | loadTicketNodes | ConditionalExpression | false | 等價 | 目錄不存在時往下的 statSync 丟例外,被 catch 回同樣的空結果 |
| 926:11 | loadTicketNodes | BlockStatement | {} | 等價 | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 927:12 | loadTicketNodes | ObjectLiteral | {} | 等價 | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 929:7 | loadTicketNodes | ConditionalExpression | false | 必補 | 補:docs/tickets 是一般檔案(不是目錄)時回空結果、不丟例外 |
| 929:33 | loadTicketNodes | ObjectLiteral | {} | 必補 | 補:docs/tickets 是一般檔案(不是目錄)時回空結果、不丟例外 |
| 931:22 | loadTicketNodes | MethodExpression | readdirSync(dir) | 必補 | 補:docs/tickets 裡有非 .md 的檔(例如 notes.txt)要被忽略 |
| 931:22 | loadTicketNodes | MethodExpression | readdirSync(dir).filter(n => n.endsWith('.md')) | 可低 | 只改 tickets Map 的插入順序;輸出行都在 augment 排過序,但沒證明每條路徑都與順序無關,不列等價 |
| 931:64 | loadTicketNodes | StringLiteral | "" | 必補 | 補:docs/tickets 裡有非 .md 的檔(例如 notes.txt)要被忽略 |
| 936:13 | loadTicketNodes | BlockStatement | {} | 必補 | 補:docs/tickets 裡有指向不存在檔案的符號連結(x.md)要略過、不丟例外 |
| 939:9 | loadTicketNodes | ConditionalExpression | false | 必補 | 補:docs/tickets 裡有名叫 x.md 的目錄要略過 |
| 958:25 | loadTicketNodes | MethodExpression | node.hits | 必補 | 補:兩張工單都動非 infra 的同一個檔(落點相同)時,不可被當成 infra 檔案層級相交(infraTouches 只收 infra 的項目) |
| 967:9 | wireDeps | Regex | /I\d+$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」(同 classifyDep 906) |
| 967:9 | wireDeps | Regex | /^I\d$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」(同 classifyDep 906) |
| 967:9 | wireDeps | Regex | /^I\d+/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」(同 classifyDep 906) |
| 970:12 | wireDeps | ConditionalExpression | false | 必補 | 補:phase 形式的依賴:phase 狀態 done 才算滿足,其他狀態(todo、in-progress、blocked)不滿足 |
| 970:12 | wireDeps | ConditionalExpression | true | 必補 | 補:phase 形式的依賴:phase 狀態 done 才算滿足,其他狀態(todo、in-progress、blocked)不滿足 |
| 970:12 | wireDeps | EqualityOperator | phases.get(node) !== 'done' | 必補 | 補:phase 形式的依賴:phase 狀態 done 才算滿足,其他狀態(todo、in-progress、blocked)不滿足 |
| 970:33 | wireDeps | StringLiteral | "" | 必補 | 補:phase 形式的依賴:phase 狀態 done 才算滿足,其他狀態(todo、in-progress、blocked)不滿足 |
| 993:54 | compareRecord | BlockStatement | {} | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 994:14 | compareRecord | Regex | /PROBLEM bad-header (\S+) (missing¦invalid) (\S+)$/ | 可低 | 去掉 ^ 或 $ 只在其他 PROBLEM 行恰好含有「PROBLEM bad-header x missing y」的字樣(例如 unresolved-ref 的原始字串)時才不同,不能嚴格證明所以不列等價 |
| 994:14 | compareRecord | Regex | /^PROBLEM bad-header (\S) (missing¦invalid) (\S+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 994:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 994:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S+)/ | 可低 | 去掉 ^ 或 $ 只在其他 PROBLEM 行恰好含有「PROBLEM bad-header x missing y」的字樣(例如 unresolved-ref 的原始字串)時才不同,不能嚴格證明所以不列等價 |
| 994:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\s+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 994:14 | compareRecord | Regex | /^PROBLEM bad-header (\s+) (missing¦invalid) (\S+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 995:14 | compareRecord | Regex | /PROBLEM bad-header (\S+) (missing¦invalid) (\S+)$/ | 可低 | 去掉 ^ 或 $ 只在其他 PROBLEM 行恰好含有「PROBLEM bad-header x missing y」的字樣(例如 unresolved-ref 的原始字串)時才不同,不能嚴格證明所以不列等價 |
| 995:14 | compareRecord | Regex | /^PROBLEM bad-header (\S) (missing¦invalid) (\S+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 995:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 995:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\S+)/ | 可低 | 去掉 ^ 或 $ 只在其他 PROBLEM 行恰好含有「PROBLEM bad-header x missing y」的字樣(例如 unresolved-ref 的原始字串)時才不同,不能嚴格證明所以不列等價 |
| 995:14 | compareRecord | Regex | /^PROBLEM bad-header (\S+) (missing¦invalid) (\s+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 995:14 | compareRecord | Regex | /^PROBLEM bad-header (\s+) (missing¦invalid) (\S+)$/ | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 996:7 | compareRecord | ConditionalExpression | false | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 996:7 | compareRecord | LogicalOperator | pa | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 996:19 | compareRecord | ConditionalExpression | true | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 996:19 | compareRecord | EqualityOperator | pa[1] !== pb[1] | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 996:36 | compareRecord | BlockStatement | {} | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 999:9 | compareRecord | ConditionalExpression | false | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 999:9 | compareRecord | ConditionalExpression | true | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 999:9 | compareRecord | EqualityOperator | ia === ib | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 999:27 | compareRecord | ArithmeticOperator | ia + ib | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:9 | compareRecord | ConditionalExpression | false | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:9 | compareRecord | ConditionalExpression | true | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:9 | compareRecord | EqualityOperator | pa[2] === pb[2] | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:33 | compareRecord | ConditionalExpression | false | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:33 | compareRecord | ConditionalExpression | true | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:33 | compareRecord | EqualityOperator | pa[2] !== 'missing' | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:43 | compareRecord | StringLiteral | "" | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1000:55 | compareRecord | UnaryOperator | +1 | 必補 | 補:同一張工單的多個 bad-header 要依欄位順序、missing 先於 invalid 排序,不同工單依 id 自然排序(T2 在 T10 前) |
| 1011:9 | makeDepth | ConditionalExpression | false | 可低 | 去掉記憶化只在圖有環時結果不同(環已是 PROBLEM),無環圖只差效能;有環時不能嚴格證明所以不列等價 |
| 1016:5 | makeDepth | CallExpression | ; | 等價 | 節點算完一定馬上 memo.set;之後再遇到它時 memo 檢查在 visiting 檢查之前,visiting 留著它不會被讀到 |
| 1018:5 | makeDepth | CallExpression | ; | 可低 | 去掉記憶化只在圖有環時結果不同(環已是 PROBLEM),無環圖只差效能;有環時不能嚴格證明所以不列等價 |
| 1028:9 | augment | Regex | /I\d+$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」 |
| 1028:9 | augment | Regex | /^I\d$/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」 |
| 1028:9 | augment | Regex | /^I\d+/ | 必補 | 補:I 閘門的有 tag/沒 tag、「I10」、「XI4」 |
| 1031:12 | augment | ConditionalExpression | true | 必補 | 補:R5 深度:未完成的 phase 依賴要算進深度(phase 狀態 done 才當滿足);phase 鏈上疊 5 層要出 WARN r5-depth |
| 1047:32 | augment | MethodExpression | ticket.resolved | 必補 | 補:todo 工單依賴「別張工單加一個 phase」且與別張成環時,環要被偵測 |
| 1052:22 | augment | MethodExpression | extra | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1052:35 | augment | ArrowFunction | () => undefined | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1052:42 | augment | MethodExpression | l.endsWith('PROBLEM cycle ') | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1052:55 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1052:75 | augment | BlockStatement | {} | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1053:24 | augment | MethodExpression | text | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1053:35 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1053:66 | augment | StringLiteral | "" | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1053:75 | augment | CallExpression | ; | 必補 | 補:環上的 todo 工單不可 READY(環上有一張已 merged、另一張 todo 時,todo 沒有 unmet 卻仍在環上) |
| 1058:9 | augment | ConditionalExpression | false | 必補 | 補:只有 status=todo 的工單才出 READY/BLOCKED;merged、dropped、dispatched、review 不出 |
| 1060:9 | augment | ConditionalExpression | false | 必補 | 補:有 unresolved 依賴、有 unmet 依賴、在環上的 todo 工單各自不出 READY |
| 1060:9 | augment | LogicalOperator | cycleNodes.has(ticket.id) && ticket.unresolved.length > 0 | 必補 | 補:有 unresolved 依賴、有 unmet 依賴、在環上的 todo 工單各自不出 READY |
| 1060:38 | augment | ConditionalExpression | false | 必補 | 補:有 unresolved 依賴、有 unmet 依賴、在環上的 todo 工單各自不出 READY |
| 1067:19 | augment | EqualityOperator | i <= occupying.length | 等價 | i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果 |
| 1072:22 | augment | ConditionalExpression | true | 必補 | 補:佔用的兩張工單在 Map 裡的順序與 id 自然順序相反時,PROBLEM 行的 id 順序仍是自然順序小的在前(檔名順序不等於 id 順序,例如 T2b 與 T2-) |
| 1072:22 | augment | EqualityOperator | compareNatural(left.id, right.id) < 0 | 等價 | dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同 |
| 1072:79 | augment | ArrayDeclaration | [] | 必補 | 補:佔用的兩張工單在 Map 裡的順序與 id 自然順序相反時,PROBLEM 行的 id 順序仍是自然順序小的在前(檔名順序不等於 id 順序,例如 T2b 與 T2-) |
| 1077:19 | augment | EqualityOperator | i <= heavyOcc.length | 等價 | i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果 |
| 1081:22 | augment | ConditionalExpression | true | 必補 | 補:佔用的兩張工單在 Map 裡的順序與 id 自然順序相反時,PROBLEM 行的 id 順序仍是自然順序小的在前(檔名順序不等於 id 順序,例如 T2b 與 T2-) |
| 1081:22 | augment | EqualityOperator | compareNatural(left.id, right.id) < 0 | 等價 | dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同 |
| 1081:79 | augment | ArrayDeclaration | [] | 必補 | 補:佔用的兩張工單在 Map 裡的順序與 id 自然順序相反時,PROBLEM 行的 id 順序仍是自然順序小的在前(檔名順序不等於 id 順序,例如 T2b 與 T2-) |
| 1093:16 | augment | ConditionalExpression | true | 必補 | 補:輕工單不受 R3(重活唯一)限制:有 heavy 在跑時 light 工單仍可 START |
| 1093:85 | augment | ConditionalExpression | true | 等價 | against 只由 occupying(dispatched/review)與 selected 組成,括號內三個條件對 against 的每個元素恆為真,改成 true 沒有差別 |
| 1095:35 | augment | ConditionalExpression | false | 必補 | 補:只有 R3 衝突(沒有 R2、沒有 R4)時工單仍是 HELD、不 START;只有 R2 時同理 |
| 1096:9 | augment | ConditionalExpression | true | 必補 | 補:只有 R2 時只印 HELD by R2;只有 R3 時只印 HELD by R3;沒有衝突時不印空的 HELD 行 |
| 1096:9 | augment | EqualityOperator | r2.length >= 0 | 必補 | 補:只有 R2 時只印 HELD by R2;只有 R3 時只印 HELD by R3;沒有衝突時不印空的 HELD 行 |
| 1097:9 | augment | ConditionalExpression | true | 必補 | 補:只有 R2 時只印 HELD by R2;只有 R3 時只印 HELD by R3;沒有衝突時不印空的 HELD 行 |
| 1097:9 | augment | EqualityOperator | r3.length >= 0 | 必補 | 補:只有 R2 時只印 HELD by R2;只有 R3 時只印 HELD by R3;沒有衝突時不印空的 HELD 行 |
| 1106:36 | augment | MethodExpression | phase.lines | 必補 | 補:phase 的 START/HELD 只對 READY 的 phase 發,BLOCKED、blocked、done 的 phase 不發 |
| 1106:75 | augment | StringLiteral | "" | 必補 | 補:phase 的 START/HELD 只對 READY 的 phase 發,BLOCKED、blocked、done 的 phase 不發 |
| 1113:49 | augment | MethodExpression | phase.edges | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1113:68 | augment | ArrowFunction | () => undefined | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1113:80 | augment | ConditionalExpression | false | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1113:80 | augment | ConditionalExpression | true | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1113:80 | augment | EqualityOperator | to !== node | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1113:97 | augment | ArrowFunction | () => undefined | 必補 | 補:R5 深度要沿 phase 邊走(phase 依賴鏈),邊的方向不可反 |
| 1117:9 | augment | ConditionalExpression | false | 等價 | 已滿足的節點 makeDepth 以 isSat 直接回 0,0 不大於 4,不會出 WARN,這個 continue 是重複 |
| 1122:71 | augment | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:一個有工單的假樹,逐字比對整份輸出(不只 toContain):不可多出不屬於任何規則的行 |
| 1124:40 | augment | StringLiteral | "Stryker was here!" | 等價 | line.split(' ')[0] 一定有值,?? 的預設值走不到 |
| 1125:5 | augment | OptionalChaining | buckets.get(kind).push | 等價 | augment 產生的每一行開頭都在 LINE_KINDS 內(READY BLOCKED HUMAN START HELD LANDING NOTE WARN PROBLEM),buckets.get 永遠有值,?. 的防護走不到 |
| 1129:27 | augment | ArrayDeclaration | ["Stryker was here"] | 必補 | 補:同 1122,整份輸出逐行比對,不可多出一行 |
| 1131:40 | augment | ArrayDeclaration | ["Stryker was here"] | 等價 | LINE_KINDS 的每個 kind 在 buckets 都有鍵,?? [] 走不到 |
| 1132:5 | augment | MethodExpression | items | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1132:16 | augment | ConditionalExpression | false | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1132:16 | augment | ConditionalExpression | true | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1132:16 | augment | EqualityOperator | kind !== 'PROBLEM' | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1132:25 | augment | StringLiteral | "" | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1132:53 | augment | ArrowFunction | () => undefined | 必補 | 補:同類行的排序:READY、BLOCKED、START、HELD 依 id 自然排序(T2 在 T10 前),PROBLEM 依 compareRecord |
| 1139:9 | augment | ConditionalExpression | false | 必補 | 補:同一條邊同時來自 phase 與工單時只輸出一次 |
| 1140:5 | augment | CallExpression | ; | 必補 | 補:同一條邊同時來自 phase 與工單時只輸出一次 |
| 1143:3 | augment | MethodExpression | edges | 必補 | 補:邊依起點、再依終點自然排序 |
| 1143:24 | augment | BlockStatement | {} | 必補 | 補:邊依起點、再依終點自然排序 |
| 1145:12 | augment | ConditionalExpression | false | 必補 | 補:邊依起點、再依終點自然排序 |
| 1145:12 | augment | ConditionalExpression | true | 必補 | 補:邊依起點、再依終點自然排序 |
| 1145:12 | augment | EqualityOperator | c === 0 | 必補 | 補:邊依起點、再依終點自然排序 |
| 1151:78 | augment | StringLiteral | "" | 必補 | 補:HUMAN 行的條數寫進摘要行的 human=;有 HUMAN 行的假樹逐字比對 |
| 1156:16 | orcaLine | ConditionalExpression | false | 等價 | depVars 為空時樣板字串 [${[].join(',')}] 就是「[]」,與提早回 '[]' 同一個字串 |
| 1165:109 | orcaScript | ConditionalExpression | true | 可低 | 工單依賴自己的情況(自環,已是 PROBLEM cycle) |
| 1176:35 | orcaScript | BlockStatement | {} | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1177:13 | orcaScript | BooleanLiteral | preds.get(ticket.id)!.includes(id) | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1177:13 | orcaScript | ConditionalExpression | false | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1177:13 | orcaScript | ConditionalExpression | true | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1178:22 | orcaScript | ArithmeticOperator | (indeg.get(ticket.id) ?? 0) + 1 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1178:23 | orcaScript | LogicalOperator | indeg.get(ticket.id) && 0 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1179:9 | orcaScript | CallExpression | ; | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1180:13 | orcaScript | ConditionalExpression | false | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1180:13 | orcaScript | ConditionalExpression | true | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1180:13 | orcaScript | EqualityOperator | left !== 0 | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1180:25 | orcaScript | CallExpression | ; | 必補 | 補:--orca 鏈的順序:id 自然排序在前的工單依賴排序在後的工單(例如 T2 依賴 T10),T10 必須先印、T2 的 --deps 有 $T10;T1→T2 的 jq 路徑 .result.task.id 也釘 |
| 1185:63 | orcaScript | ArrowFunction | () => undefined | 可低 | 有環的工單(不在任何一輪解鎖)接在最後依 id 自然排序輸出;環已是 PROBLEM |
| 1185:91 | orcaScript | CallExpression | ; | 可低 | 有環的工單(不在任何一輪解鎖)接在最後依 id 自然排序輸出;環已是 PROBLEM |
| 1186:85 | orcaScript | ArrayDeclaration | ["Stryker was here"] | 等價 | order 裡的 id 都來自 batch,preds 對 batch 的每個 id 都有值,?? [] 走不到 |
| 1187:10 | orcaScript | ConditionalExpression | false | 可低 | 沒有 todo 工單時 --orca 輸出空字串(不是換行);字樣排版 |
| 1187:31 | orcaScript | StringLiteral | "Stryker was here!" | 可低 | 沒有 todo 工單時 --orca 輸出空字串(不是換行);字樣排版 |
| 1206:21 | parseFlags | MethodExpression | value.endsWith('-') | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1207:11 | parseFlags | ConditionalExpression | false | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1207:26 | parseFlags | CallExpression | ; | 可低 | 參數錯誤分支(--root 後面是旗標、重複 --root);只影響用法訊息與錯誤退出 |
| 1220:7 | main | ConditionalExpression | false | 等價 | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
| 1224:11 | main | BlockStatement | {} | 等價 | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
| 1225:10 | main | StringLiteral | '' | 等價 | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
| 1239:21 | invokedAsCli | MethodExpression | process.argv | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1240:9 | invokedAsCli | ConditionalExpression | false | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1240:9 | invokedAsCli | LogicalOperator | !arg && arg.startsWith('-') | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
| 1240:17 | invokedAsCli | MethodExpression | arg.endsWith('-') | 可低 | CLI 殼:判斷是不是被直接執行;被當模組 import 與 CLI 行為都有測試,剩下的是 argv 切片的邊角 |
