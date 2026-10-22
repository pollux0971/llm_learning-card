# 驗收證據:T39 第三輪(第二輪補測後重測)

- 基底:t39-red-3 0dcef65e242a9742c9d8123d6e7bc1280734d756(= t39-verify 4baf683 加第二輪補測);驗收樹(開跑與跑完相同)tree 26ba7d54122c62fe8dd14cb90b7205cd4e9478f6
- 驗收者:驗收線 -5a,日期 2026-10-22;沒有 .env
- 前幾輪:acceptance-T39.md、acceptance-T39-round2.md、acceptance-T39-round2-survivors.md

## 結論

**必補區剩 1 隻(1090 行 35 欄),其餘清完;分數遠高於標準級。** 這 1 隻不是「為殺而殺」,是真行為(環上有已 merged 成員的 todo 工單,工單 id 是多字元時不可 READY),測試用多字元 id(T1、T2)就殺得掉,請 -1d 補一條;補完我只重測那一行。其餘 21 隻存活者:等價 14(逐隻理由見下)、可低 7。等價註解由協調者加、我再核 diff 只有註解,在那之前分數照未扣等價算。

## 範圍與測試作者

- t39-red-3 相對 t39-verify 只多 scripts/dag.test.ts +602 行、0 刪除(git diff --stat);scripts/dag.ts 與 t39-verify 逐位元組相同(git diff --quiet);3 個 commit(adea075、1842604、0dcef65)都是測試線 -1d;歷史無 mutants.out。既有斷言沒被改或刪。
- 協調者提醒 adea075 是中途版,以 0dcef65 為準:我驗的就是 0dcef65。

## 變異重測

指令(完整):

    npm run mutate -- stryker.t39-dag-rerun2.json

設定:mutate 為 scripts/dag.ts 的 36 段行範圍(第二輪清單中必補 83 隻與 1093:85 所在的 48 行;dag.ts 沒動,行號與 t39-verify 相同);測試 MUTATE_TEST_GLOB='{scripts/dag.test.ts,scripts/dag-check.test.ts}',vitest --bail=1;concurrency 2、timeoutMS 120000、thresholds 90/80/0;CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1。報告 reports/mutation/0dcef65-t39-dag-rerun2.json。

結果:258 隻:殺 236、存活 22、逾時 0、錯誤 0(另有 15 隻被註解略過)。耗時 88 分 15 秒。

第二輪的 84 個目標(必補 83 + 1093:85)裡,67 隻被殺、17 隻仍存活(另外 5 隻存活者是原本就標可低、因為同一行被重跑)。

分數(顧問的收法):

| 項 | 數 |
|---|---|
| 第一輪殺 | 845 |
| 第二輪(重測一)新殺 | 91 |
| 本輪新殺 | 67 + 1(原可低、同行被殺:compareRecord 一隻)= 68 |
| 目前殺 | 1004 |
| 等價:已加註解 71 + 1093:85 + 本輪新判 13 | 85 |
| **分數** 1004/(1111−85) | **1004/1026 = 97.86%** |
| 若本輪新判等價 13 隻註解未成立(分母只扣 72) | 1004/1039 = 96.63% |

兩種算法都遠高於 80%。

## 22 隻存活者逐隻(行號是 t39-verify / t39-red-3 的 scripts/dag.ts)

行:欄、mutator 之後的「-1d 說」是協調者轉述的 -1d 丟棄式結果。

| 行:欄 | 函式 | mutator | 判定 | 理由 | -1d 說 |
|---|---|---|---|---|---|
| 725:16 | parseHeaderText | Regex | 可低 | 去掉結尾 $ 只在行內含 \r 或 U+2028 這類行終止字元時才不同;檔頭行不會有,但不能嚴格證明 | 可低(同) |
| 762:16 | parseHeaderText | ConditionalExpression | 等價 | idRaw!==undefined 改 true:id 缺漏時 idOk 雖變 true(TICKET_ID_RE.test(undefined) 把它當字串 "undefined" 通過),但下一行 name 的條件還有 idRaw!==undefined,走回檔名;而 id 缺漏已在迴圈中進 issues,最後回 node:null,idOk 沒有別處用到 | 等價(同) |
| 763:24 | parseHeaderText | ConditionalExpression | 等價 | name 的條件 idOk && idRaw!==undefined 裡第二項改 true:idOk 為真蘊含 idRaw 已定義,所以第二項恆為真 | 等價(同) |
| 940:48 | classifyDep | ConditionalExpression | 等價 | find 的條件 r.kind===phase 改 true:下一行 941 立刻再檢查 phase.kind===phase,非 phase 一樣落到 unresolved | 等價(同) |
| 941:16 | classifyDep | ConditionalExpression | 等價 | phase.kind===phase 改 true:find 已只回 kind 為 phase 的元素(或 undefined,由前一項 phase && 擋) | 等價(同) |
| 942:9 | classifyDep | ConditionalExpression | 等價 | phase.folder===null 改 false:往下的 lookupFolder(null, 名單) 比對不到任何資料夾(沒有資料夾名叫「null」或以「null-」開頭,資料夾名是兩位數字開頭),回 null,同樣走 unresolved | 等價(同) |
| 944:9 | classifyDep | ConditionalExpression | 等價 | folder!==null 改 true:folder 為 null 時 tables.get(null) 是 undefined,?.has 得 undefined,條件仍假 | (未列) |
| 944:28 | classifyDep | OptionalChaining | 等價 | folder 不是 null 時它必是 tables 的鍵(lookupFolder 只從 tables.keys() 找),tables.get(folder) 一定有值,?. 的防護走不到 | 等價(同) |
| 967:22 | loadTicketNodes | MethodExpression | 可低 | 拿掉 sort(compareNatural):只改 tickets Map 的插入順序(readdirSync 預設字母序),輸出行都在 augment 排過序,但沒逐路徑證明,不列等價 | 可低(同) |
| 1030:14 | compareRecord | Regex(去 ^) | 可低 | 去掉 ^ 只在其他 PROBLEM 行恰好含「PROBLEM bad-header x missing y」字樣時才不同(例如依賴字串寫成那樣);要殺只能構造這種為殺而殺的輸入 | 等價 |
| 1030:14 | compareRecord | Regex(去 $) | 可低 | 同上,去 $ 要構造行尾多餘字樣 | 可低(同) |
| 1031:14 | compareRecord | Regex(去 ^) | 可低 | 同 1030 去 ^ | 等價 |
| 1036:9 | compareRecord | ConditionalExpression | 等價 | pa[2]!==pb[2] 改 true:走到這裡時名字、欄位都相同;kind 也相同時兩行字串逐字相同,誰先誰後看不出差別;kind 不同時結果與原版相同 | 等價(同,他寫 1036:33) |
| 1084:32 | augment | MethodExpression | 等價 | 拿掉 filter(tickets.has):多出的節點是 phase 或 I 閘門,在 ticketNeeds 裡沒有自己的出邊,findCycles 的環不可能經過它們 | 等價(同) |
| 1089:22 | augment | MethodExpression | 可低 | 拿掉 extra.filter:改成掃所有已累積的行,把 slice(14) 後的片段當環節點;要影響結果得有工單 id 恰好等於某行第 15 字元起的片段,為殺而殺 | 可低(同) |
| 1089:55 | augment | StringLiteral | 可低 | startsWith('') 恆真,同上 | 可低(同) |
| 1090:24 | augment | MethodExpression | 等價 | 拿掉 slice:第一段變成「PROBLEM cycle A」不是 id,但 findCycles 的輸出格式是「A -> B -> A」(起點在尾端重複),A 仍在最後一段被收進去 | 等價(同) |
| **1090:35** | augment | StringLiteral | **必補** | split(' -> ') 改 split(''):逐字元切,多字元 id(T1)進不了 cycleNodes,環上已 merged 成員旁的 todo 工單會被當成 READY。現有測試的環大概用單字元 id,所以殺不掉;用 T1、T2 這種 id 的環加一個 merged 成員就會紅。這是真行為 | 等價(**不同意**) |
| 1134:85 | augment | ConditionalExpression | 等價 | against 只由 occupying(dispatched/review)與 selected 組成,括號內三個條件對 against 的每個元素恆為真,改 true 沒有差別(同 1093:85 的判斷) | (未列) |
| 1177:16 | augment | ConditionalExpression | 等價 | kind===PROBLEM 改 true:所有種類都用 compareRecord;compareRecord 對非 bad-header 的行直接退回 compareNatural(lineKey),與非 PROBLEM 種類原用的比較器相同,而非 PROBLEM 的行本來就沒有 bad-header 行 | 等價(同) |
| 1184:9 | augment | ConditionalExpression | 等價 | 去重判斷改 false:phase 邊在 analyzeTree 的 addEdge 已去重,工單邊每張工單的 resolved 是 uniqueSorted、起點與終點組合不重複,而且工單 id 不會等於 phase 節點名,兩邊來源互不相交,所以重複從不發生 | 等價(同) |
| 1185:5 | augment | CallExpression | 等價 | 同上,edgeKeys.add 拿掉也不會有重複可擋 | 等價(同) |

合計:等價 14(762:16、763:24、940:48、941:16、942:9、944:9、944:28、1036:9、1084:32、1090:24、1134:85、1177:16、1184:9、1185:5)、可低 7(725:16、967:22、1030 ×2、1031、1089 ×2)、必補 1(1090:35)。-1d 說的等價 15 隻,我同意 12 隻 +2 隻他沒列的(944:9、1134:85);不同意 3 隻(1030/1031 的去 ^ 兩隻,我歸可低;1090:35,我歸必補)。為殺而殺的可低共 5 隻(1030 ×2、1031、1089 ×2),低於顧問的 10 隻上限。

### 加註解建議(等價 14 隻)

每隻都能用 disable next-line 加指定 mutator 名,不需用 all:行 762 ConditionalExpression、763 ConditionalExpression、940 ConditionalExpression、941 ConditionalExpression、942 ConditionalExpression、944 同行有 ConditionalExpression 與 OptionalChaining 兩隻、1036 ConditionalExpression、1084 MethodExpression、1090 只對 MethodExpression(同行的 StringLiteral 是必補,不可蓋)、1134 ConditionalExpression(此行同 mutator 在第 16 欄的那隻已被殺,蓋掉不影響存活統計,但會把已殺的也略過,可接受)、1177 ConditionalExpression、1184 ConditionalExpression、1185 CallExpression。1030、1031 的 Regex 不加(可低)。行號是這一版;加註解後會位移,請以行內容對位。

## 必補反引號 must_catch(協調者要我確認的 3 條)

手工改壞:把 parseInlineList 的拒絕字元加上反引號(行內清單含反引號即不合法)。結果:紅,第一個紅的是補測2·行內清單含反引號的測試(must_catch: [`a`, b]、deps: [`T2`]、touches: [`docs/a/`]:檔頭不出 bad-header;反引號留在字面上)。再重做逐行清單(block)反引號版本的改壞:紅(逐行清單項目以反引號開頭、或項目中含反引號)。第一輪存活的缺口(348 條全綠)已補上。

## 完整套件與 check:test-ledger(t39-red-3)

npm run check:test-ledger(內含完整套件,VITEST_MAX_WORKERS=1):229 檔全過、6259 過、171 skipped(共 6430),耗時 1084 秒;帳本行數相同 108;gate=ledger-pollution result=PASS。這是乾淨的 PASS(第二輪那兩條 review-engine 逾時這次沒有再出現)。

## 資料前後

learning/(唯一量法)前後都是 64 / c2e4dd6d71de3976 / 108;tree sha 前後相同;worktree 已刪、無殘留行程。
