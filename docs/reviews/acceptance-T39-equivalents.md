# T39 等價變異逐隻清單(72 隻)

- 被驗:t39-impl b91bd0354b751f942b71477c606c8df5d3498adf 的 scripts/dag.ts;行號與欄號是這個版本的(加註解後行號會移動,請以「行內容」欄對位)。
- 只列我有把握「行為一樣」的。不確定的(例如去掉記憶化只在有環時才不同)不在這裡,留在存活區,在 acceptance-T39-survivors.md 標「可低」。
- 「替換」截 60 字;行與欄完整。

## 怎麼加註解

Stryker 的註解是 disable next-line 加 mutator 名(或 all)加冒號加理由。以下兩種:

1. **整行都是等價**的行(43 行)可以用 all:664, 665, 666, 673, 677, 678, 689, 723, 725, 740, 741, 742, 766, 771, 776, 781, 786, 790, 800, 801, 802, 804, 819, 820, 864, 866, 895, 919, 922, 926, 927, 1016, 1067, 1077, 1117, 1124, 1125, 1131, 1156, 1186, 1220, 1224, 1225。
2. **同一行還有必補的存活者**的行(8 行)不可用 all,否則會把必補的一起蓋掉。這些行改用指定 mutator 的版本:
   - 行 688:等價的是 20 欄 StringLiteral;同行必補的是 7 欄 MethodExpression。指定 mutator 名即可分開。
   - 行 815:等價的是 7 欄 ConditionalExpression;同行必補的是 33 欄 ArrayDeclaration。指定 mutator 名即可分開。
   - 行 822:等價的是 7 欄 ConditionalExpression;同行必補的是 28 欄 ArrayDeclaration。指定 mutator 名即可分開。
   - 行 825:等價的是 9 欄 ConditionalExpression;同行必補的是 44 欄 ArrayDeclaration。指定 mutator 名即可分開。
   - 行 840:等價的是 10 欄 ConditionalExpression;同行必補的是 77 欄 EqualityOperator。指定 mutator 名即可分開。
   - 行 1072:等價的是 22 欄 EqualityOperator;同行必補的是 22 欄 ConditionalExpression、79 欄 ArrayDeclaration。指定 mutator 名即可分開。
   - 行 1081:等價的是 22 欄 EqualityOperator;同行必補的是 22 欄 ConditionalExpression、79 欄 ArrayDeclaration。指定 mutator 名即可分開。
   - 行 1093:等價的是 85 欄 ConditionalExpression;同行必補的是 16 欄 ConditionalExpression。**同一個 mutator 名同時有等價與必補,無法用註解分開,這一行請不要加註解,等價那隻留在存活區讓 -1d 的測試順手殺。**

## 逐隻

| 行:欄 | 函式 | mutator | 替換(截 60 字) | 行內容 | 為什麼行為一樣 |
|---|---|---|---|---|---|
| 664:13 | stripKeyComment | Regex | /(?:\s)#/ | const m = /(?:^¦\s)#/.exec(line); | 行首 # 那一支永遠走不到:呼叫它之前第 706 行已把「第一個非空白字元是 #」的行整行略過,只剩「空白加 #」有作用 |
| 665:18 | stripKeyComment | MethodExpression | line.trimStart() | if (!m) return line.trimEnd(); | 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串 |
| 666:10 | stripKeyComment | MethodExpression | line.slice(0, m.index).trimStart() | return line.slice(0, m.index).trimEnd(); | 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串 |
| 673:7 | parseInlineList | ConditionalExpression | false | if (inner.trim() === '') return []; | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 673:7 | parseInlineList | MethodExpression | inner | if (inner.trim() === '') return []; | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 673:24 | parseInlineList | StringLiteral | "Stryker was here!" | if (inner.trim() === '') return []; | 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複 |
| 677:52 | scalarUnsupported | BlockStatement | {} | function scalarUnsupported(value: string): boolean { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:10 | scalarUnsupported | ConditionalExpression | false | return /['"{}\[\]¦]/.test(value) ¦¦ value.startsWith('>'); | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:10 | scalarUnsupported | LogicalOperator | /['"{}\[\]¦]/.test(value) && value.startsWith('>') | return /['"{}\[\]¦]/.test(value) ¦¦ value.startsWith('>'); | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 678:39 | scalarUnsupported | MethodExpression | value.endsWith('>') | return /['"{}\[\]¦]/.test(value) ¦¦ value.startsWith('>'); | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變 |
| 688:20 | parseHeaderText | StringLiteral | "Stryker was here!" | if ((lines[0] ?? '').trim() !== '---') { | lines[0] 一定存在(split 至少回一個元素),?? 的預設值走不到 |
| 689:43 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | return { missingHeader: true, issues: [], name: filename, node: null }; | missingHeader 為 true 時 loadTicketNodes 只印 missing-header 然後 continue,不讀 issues |
| 723:19 | parseHeaderText | MethodExpression | km[2] ?? '' | const value = (km[2] ?? '').trim(); | 呼叫端已把整行 trim,且正則 \s* 吃掉冒號後的空白、(.*) 貪婪到行尾,km[2] 不會有頭尾空白 |
| 723:29 | parseHeaderText | StringLiteral | "Stryker was here!" | const value = (km[2] ?? '').trim(); | (.*) 一定有參與匹配,km[2] 不會是 undefined,?? 的預設值走不到 |
| 725:9 | parseHeaderText | ConditionalExpression | false | if (!HEADER_FIELDS.includes(key as (typeof HEADER_FIELDS)[number])) continue; | 不在 HEADER_FIELDS 的 key 只寫進 seen/scalars/bad,之後只用 HEADER_FIELDS 的名字去讀,多寫不影響輸出 |
| 740:16 | parseHeaderText | ConditionalExpression | false | } else if (scalarUnsupported(value) ¦¦ value === '') { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:16 | parseHeaderText | LogicalOperator | scalarUnsupported(value) && value === '' | } else if (scalarUnsupported(value) ¦¦ value === '') { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:44 | parseHeaderText | ConditionalExpression | false | } else if (scalarUnsupported(value) ¦¦ value === '') { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:54 | parseHeaderText | StringLiteral | "Stryker was here!" | } else if (scalarUnsupported(value) ¦¦ value === '') { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 740:58 | parseHeaderText | BlockStatement | {} | } else if (scalarUnsupported(value) ¦¦ value === '') { | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 741:7 | parseHeaderText | CallExpression | ; | bad.add(key); | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 742:7 | parseHeaderText | CallExpression | ; | scalars.set(key, value); | 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null |
| 766:39 | parseHeaderText | StringLiteral | "Stryker was here!" | const v = scalars.get('cpu') ?? ''; | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 771:42 | parseHeaderText | StringLiteral | "Stryker was here!" | const v = scalars.get('status') ?? ''; | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 776:41 | parseHeaderText | StringLiteral | "Stryker was here!" | const v = scalars.get('owner') ?? ''; | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 781:46 | parseHeaderText | StringLiteral | "Stryker was here!" | const v = scalars.get('budget_usd') ?? ''; | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 786:47 | parseHeaderText | StringLiteral | "Stryker was here!" | const status = scalars.get('status') ?? ''; | 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到 |
| 790:37 | parseHeaderText | ConditionalExpression | false | if (issues.length > 0 ¦¦ !idOk ¦¦ idRaw === undefined) return { missingHeader: false, issu | issues 為空時 id 欄位一定通過 idOk(否則 id 欄位早已進 issues),所以 !idOk 與 idRaw===undefined 恆為 false,多餘的防護 |
| 800:34 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | deps: lists.get('deps') ?? [], | deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到 |
| 801:40 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | touches: lists.get('touches') ?? [], | deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到 |
| 802:13 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | hits: [], | hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀 |
| 804:21 | parseHeaderText | ArrayDeclaration | ["Stryker was here"] | infraTouches: [], | hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀 |
| 815:7 | loadLandings | ConditionalExpression | false | if (!existsSync(path)) return []; | existsSync 為假時往下的 statSync 會丟例外,被 catch 回 [],結果相同 |
| 819:11 | loadLandings | BlockStatement | {} | } catch { | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 820:12 | loadLandings | ArrayDeclaration | ["Stryker was here"] | return []; | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 822:7 | loadLandings | ConditionalExpression | false | if (!st.isFile()) return []; | 路徑是目錄時往下的 readFileSync 丟 EISDIR,被 catch 回 [],結果相同 |
| 825:9 | loadLandings | ConditionalExpression | false | if (!Array.isArray(raw.owners)) return []; | owners 不是陣列時 for-of 對 undefined/物件/數字丟 TypeError(被 catch 回 []),對字串逐字走訪但每個字都不是陣列列而被略過,結果都是 [] |
| 840:10 | resolveTouch | ConditionalExpression | false | if ((touch === prefix ¦¦ touch.startsWith(prefix)) && (best === null ¦¦ prefix.length > be | touch===prefix 蘊含 touch.startsWith(prefix),左邊那一支是重複條件 |
| 864:24 | overlapReasons | MethodExpression | [...b.landings] | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | ConditionalExpression | true | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | ConditionalExpression | true | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:54 | overlapReasons | LogicalOperator | l !== 'infra' | l !== 'contracts' ¦¦ const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:60 | overlapReasons | StringLiteral | "" | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:71 | overlapReasons | ConditionalExpression | true | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 864:77 | overlapReasons | StringLiteral | "" | const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts')); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | ConditionalExpression | true | if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | ConditionalExpression | true | if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:9 | overlapReasons | LogicalOperator | l !== 'infra' | l !== 'contracts' ¦¦ if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:15 | overlapReasons | StringLiteral | "" | if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:26 | overlapReasons | ConditionalExpression | true | if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 866:32 | overlapReasons | StringLiteral | "" | if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l); | 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變 |
| 895:9 | phaseTables | ConditionalExpression | false | if (slash < 0) continue; | 節點名由 nodeName 組成,一定含「/phase-」且資料夾名非空,slash 不會小於等於 0 |
| 895:9 | phaseTables | EqualityOperator | slash <= 0 | if (slash < 0) continue; | 節點名由 nodeName 組成,一定含「/phase-」且資料夾名非空,slash 不會小於等於 0 |
| 919:30 | loadTicketNodes | ArrayDeclaration | ["Stryker was here"] | const problems: string[] = []; | augment 的 take() 只收 LINE_KINDS 開頭的行,「Stryker was here」的 kind 不在其中,被丟掉,不進輸出也不計數 |
| 922:7 | loadTicketNodes | ConditionalExpression | false | if (!existsSync(dir)) return { problems, tickets }; | 目錄不存在時往下的 statSync 丟例外,被 catch 回同樣的空結果 |
| 926:11 | loadTicketNodes | BlockStatement | {} | } catch { | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 927:12 | loadTicketNodes | ObjectLiteral | {} | return { problems, tickets }; | existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到 |
| 1016:5 | makeDepth | CallExpression | ; | visiting.delete(n); | 節點算完一定馬上 memo.set;之後再遇到它時 memo 檢查在 visiting 檢查之前,visiting 留著它不會被讀到 |
| 1067:19 | augment | EqualityOperator | i <= occupying.length | for (let i = 0; i < occupying.length; i++) { | i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果 |
| 1072:22 | augment | EqualityOperator | compareNatural(left.id, right.id) < 0 | const [a, b] = compareNatural(left.id, right.id) <= 0 ? [left, right] : [right, left]; | dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同 |
| 1077:19 | augment | EqualityOperator | i <= heavyOcc.length | for (let i = 0; i < heavyOcc.length; i++) { | i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果 |
| 1081:22 | augment | EqualityOperator | compareNatural(left.id, right.id) < 0 | const [a, b] = compareNatural(left.id, right.id) <= 0 ? [left, right] : [right, left]; | dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同 |
| 1093:85 | augment | ConditionalExpression | true | const r3 = ticket.cpu === 'heavy' ? against.filter((o) => o.cpu === 'heavy' && (o.status = | against 只由 occupying(dispatched/review)與 selected 組成,括號內三個條件對 against 的每個元素恆為真,改成 true 沒有差別 |
| 1117:9 | augment | ConditionalExpression | false | if (satisfied(node)) continue; | 已滿足的節點 makeDepth 以 isSat 直接回 0,0 不大於 4,不會出 WARN,這個 continue 是重複 |
| 1124:40 | augment | StringLiteral | "Stryker was here!" | const kind = line.split(' ')[0] ?? ''; | line.split(' ')[0] 一定有值,?? 的預設值走不到 |
| 1125:5 | augment | OptionalChaining | buckets.get(kind).push | buckets.get(kind)?.push(line); | augment 產生的每一行開頭都在 LINE_KINDS 內(READY BLOCKED HUMAN START HELD LANDING NOTE WARN PROBLEM),buckets.get 永遠有值,?. 的防護走不到 |
| 1131:40 | augment | ArrayDeclaration | ["Stryker was here"] | const items = buckets.get(kind) ?? []; | LINE_KINDS 的每個 kind 在 buckets 都有鍵,?? [] 走不到 |
| 1156:16 | orcaLine | ConditionalExpression | false | const deps = depVars.length === 0 ? '[]' : '[${depVars.map((v) => '\\"$${v}\\"').join(',') | depVars 為空時樣板字串 [${[].join(',')}] 就是「[]」,與提早回 '[]' 同一個字串 |
| 1186:85 | orcaScript | ArrayDeclaration | ["Stryker was here"] | const lines = order.map((id) => orcaLine(id, byId.get(id)!.file, preds.get(id) ?? [])); | order 裡的 id 都來自 batch,preds 對 batch 的每個 id 都有值,?? [] 走不到 |
| 1220:7 | main | ConditionalExpression | false | if (!existsSync(root)) fail('root not found: ${root}'); | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
| 1224:11 | main | BlockStatement | {} | } catch { | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
| 1225:10 | main | StringLiteral | '' | fail('root not found: ${root}'); | existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到 |
