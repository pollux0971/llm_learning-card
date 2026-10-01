# `check-doc-links.ts` 存活變異逐項判讀（2026-09-13）

## 量測紀錄

開工前環境與 guard：

```bash
export LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10 TEMPLATE_DIR=/data/python/dev-paradigm
npx vitest run scripts/zero-input-guard.test.ts
```

結果：694 passed、164 skipped。CodeGraph MCP 回報本 worktree 尚未初始化，已詢問協調者是否執行 `codegraph init -i`，未在等待逾時前收到回覆，因此本次以檔案與測試結果判讀。

所有 mutation 量測實際執行的完整命令（包含影響該次跑的環境變數）都是：

```bash
export LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10 TEMPLATE_DIR=/data/python/dev-paradigm; MUTATE_TEST_GLOB='scripts/check-doc-links*.test.ts' npm run mutate -- stryker.scanner-doclinks.json
```

第一次基準量測：436 mutants，320 killed、61 timeout、47 survived、8 no-coverage，87.39%，4 分 38 秒（另有鎖等待前置）。加入第一批測試後：347 killed、48 timeout、35 survived、6 no-coverage，90.60%，4 分 38 秒；加入設定錯誤與反引號測試後仍為 90.60%；再加入 parser 邊界測試後的最終量測：349 killed、48 timeout、33 survived、6 no-coverage，91.06%，2 分 35 秒。全部 rc=0，未出現 137/144。

## 分佈

| 判讀 | 數量 |
|---|---:|
| 真漏測 | 5 |
| 訊息措辭 | 1 |
| 死程式 | 1 |
| 邊界沒守 | 1 |
| 等價（其他） | 19 |
| 未判定 | 6 |
| **存活合計** | **33** |

另有 6 個 `NoCoverage`（列在文末），不是 Stryker 的 `Survived`，不混入上表。

## 33 個 survived 逐項判讀

每行的「使用者看到什麼」是分類依據；分類為真漏測或邊界沒守者，已在 `scripts/check-doc-links.local.test.ts` 補測試（若測試以子行程驗設定錯誤，Stryker 不會把子行程的原始碼計入 mutant coverage，故仍可能留下 survived）。

1. `check-doc-links.ts:117:7` LogicalOperator，`envDir || existsSync(envDir)`：**等價（其他）**。`process.env` 的值只能是字串或 `undefined`；字串非空時兩邊都為真，空字串/未設時 `existsSync('')` 也為假，對候選設定檔沒有不同結果。
2. `check-doc-links.ts:115:32` ArrayDeclaration，`[]` → `['Stryker was here']`：**真漏測**。若 cwd 恰有此名稱，`find(existsSync)` 會把它當設定檔候選，使用者可能看到錯誤設定或設定檔錯誤；目前沒有釘住候選清單不得含幽靈項目的測試。
3. `check-doc-links.ts:120:89` StringLiteral，`'scripts'` → `''`：**真漏測**。`<root>/scripts/gates.config.json` 會變成 `<root>/gates.config.json`，consumer 的 skip 設定可能不被讀到，使用者看到錯誤的掃描範圍/結果。
4. `check-doc-links.ts:120:78` StringLiteral，`'scripts'` → `''`：**真漏測**。同一個候選串的另一段被清空；外部模板執行且沒有 `GATES_CONFIG_DIR` 時，root 下的設定解析會偏離文件規定，使用者看到自訂設定未套用或錯誤設定。
5. `check-doc-links.ts:161:73` StringLiteral，`'docLinks'` → `''`：**訊息措辭**。只改設定型別錯誤訊息指出的鍵名，行為仍會 fail；這是給人讀的診斷文字，不為字面措辭補脆弱斷言。
6. `check-doc-links.ts:153:7` ConditionalExpression，`config.skipDirs !== undefined` → `true`：**等價（其他）**。對合法設定，缺少 `skipDirs` 時 `resolveSkipDirs` 本身回傳預設集合；存在時原本就會進入，故輸出與掃描集合相同。
7. `check-doc-links.ts:156:5` CallExpression，移除 `resolveSkipDirs(...)`：**真漏測**。`skipDirs` 型別錯或含不支援 glob 時，本應明確 FAIL；移除驗證會靜默繼續，使用者看到錯誤設定被接受。已補 CLI 子行程測試。
8. `check-doc-links.ts:161:7` ConditionalExpression，`config.docLinks !== undefined` → `false`：**真漏測**。`docLinks` 不是 object 時會繞過共用型別檢查，使用者看到 malformed config 沒有明確 FAIL。已補 CLI 子行程測試。
9. `check-doc-links.ts:198:13` Regex，移除 match-fence regex 的尾端 `$`：**等價（其他）**。前面的 `(.*)` 已貪婪吃完該行，而輸入是 `split('\n')` 後的單行；是否再要求行尾不改 match 結果。
10. `check-doc-links.ts:225:12` ConditionalExpression，`j < line.length` → `true`：**等價（其他）**。到行尾後 `line[j]` 是 `undefined`，第二個條件仍為假，迴圈不多消費內容。
11. `check-doc-links.ts:225:12` EqualityOperator，`j < line.length` → `j <= line.length`：**等價（其他）**。同上；新增的行尾迭代只讀到 `undefined`，不改 `j` 或輸出。
12. `check-doc-links.ts:230:12` EqualityOperator，`k < line.length` → `k <= line.length`：**等價（其他）**。多一次 `line[k] !== '`'` 的行尾判定後遞增到 length+1，退出時狀態與原程式相同。
13. `check-doc-links.ts:236:14` EqualityOperator，`e < line.length` → `e <= line.length`：**等價（其他）**。行尾的 `line[e]` 為 `undefined`，不會再計入反引號。
14. `check-doc-links.ts:236:14` ConditionalExpression，`e < line.length` → `true`：**等價（其他）**。即使上界條件恆真，`line[e] === '`'` 在行尾為假，內容與索引不變。
15. `check-doc-links.ts:364:27` ArrayDeclaration，`[]` → `['Stryker was here']`：**等價（其他）**。這個字串不符合 `path:positiveInteger`，只會成為永遠不被消費的假 span，不改任何回傳或輸出。
16. `check-doc-links.ts:366:10` EqualityOperator，`i < line.length` → `i <= line.length`：**等價（其他）**。多處理一個 `undefined` 行字串，`?? ''` 轉成空字串且不產生 span。
17. `check-doc-links.ts:372:12` ConditionalExpression，`j < line.length` → `true`：**等價（其他）**。第二項 `line[j] === '`'` 在行尾阻止越界內容進入 span。
18. `check-doc-links.ts:372:12` EqualityOperator，`j < line.length` → `j <= line.length`：**等價（其他）**。只增加一次行尾的 undefined 判定。
19. `check-doc-links.ts:377:22` UnaryOperator，`closeStart = -1` → `+1`：**等價（其他）**。找到收尾時一定會以真實 `k` 覆寫；找不到收尾時 `end === -1` 會先 continue，永遠不讀 `closeStart`。
20. `check-doc-links.ts:378:12` EqualityOperator，`k < line.length` → `k <= line.length`：**等價（其他）**。行尾只會讀到 undefined 並退出，不會產生收尾。
21. `check-doc-links.ts:384:14` EqualityOperator，`e < line.length` → `e <= line.length`：**等價（其他）**。同一 span 掃描的行尾判定不改 span 內容。
22. `check-doc-links.ts:384:14` ConditionalExpression，`e < line.length` → `true`：**等價（其他）**。`line[e] === '`'` 仍在行尾為假，因此不會虛構反引號。
23. `check-doc-links.ts:385:11` ConditionalExpression，`e - k === n` → `true`：**邊界沒守**。不同長度的反引號被視為收尾，會把普通文字截成 inline span，進而把使用者文件中的路徑文字當成連結、報假壞連結；目前 mutation 仍存活，雖已補直接 parser 邊界測試，應由後續 maintainer 決定是否調整測試/執行方式。
24. `check-doc-links.ts:416:19` EqualityOperator，`i < lines.length` → `i <= lines.length`：**等價（其他）**。額外迭代得到 `lines[i] ?? ''` 的空行，不會產生 path ref。
25. `check-doc-links.ts:436:65` MethodExpression，`posix.startsWith(...)` → `posix.endsWith(...)`：**等價（其他）**。`isSkipped` 先檢查 `posix === prefix`；對 walker 而言，prefix 對應的目錄在遞迴前已被 exact-match 跳過，子樹不會走到需要 `startsWith` 的情況，因此此替換不改實際被 yield 的 markdown 集合。
26. `check-doc-links.ts:454:7` ConditionalExpression，`existsSync(root)` → `true`：**死程式**。CLI 的 `main()` 在進入 `markdownFiles` 前已對明講的 `--root` 做 `rootDirError`，正常使用不會把不存在 root 傳進來；這是 exported test helper 的防禦分支，移除不改 CLI 使用者可見行為。
27. `check-doc-links.ts:522:7` ConditionalExpression，`rootArg !== undefined` → `true`：**等價（其他）**。無 `--root` 時使用模組載入時已由 git 解析出的現存 repo root；有 `--root` 時本來就為真，對支援的 argv 形狀兩者都不改輸出。
28. `check-doc-links.ts:560:47` StringLiteral，`'check-doc-links.ts'` → `''`：**未判定**。直接以該檔執行時兩者都會進入 CLI；import 成 module 時才有差異，但目前 Stryker 測試是父行程 import、子行程不計入 mutated source，無法據此決定是否把 import side effect 當公開契約。
29. `check-doc-links.ts:561:5` ConditionalExpression，`if (isDirectRun)` → `if (true)`：**未判定**。直接 CLI 執行沒有差異，只有被其他模組 import 時會無條件執行；該 import 是否為支援用法需 maintainer 定義。
30. `check-doc-links.ts:560:21` LogicalOperator，`endsWith(...) ?? false` → `endsWith(...) && false`：**未判定**。它改變的是 module import 的 direct-run 判定；現有 spawned CLI 測試不會在 mutant 進程內執行，無足夠證據把它硬塞進等價。
31. `check-doc-links.ts:560:21` MethodExpression，`endsWith(...)` → `startsWith(...)`：**未判定**。直接 CLI 的 argv[1] 路徑以檔名結尾，`startsWith` 通常為假而會漏執行 CLI；但 mutation 報告的測試沒有 instrumented direct-run coverage，需 maintainer 決定支援的啟動路徑後再補驗證。
32. `check-doc-links.ts:560:21` OptionalChaining，移除 `?.`：**未判定**。module import 時 `process.argv[1]` 可能為 undefined，會由安全的 false 變成例外；但這只發生在未被直接執行的載入情境，現有可見使用者契約未定。
33. `check-doc-links.ts:561:5` ConditionalExpression，`if (isDirectRun)` → `if (false)`：**未判定**。直接 CLI 會完全不輸出、不回傳退出碼，顯然可能是漏測；但目前測試僅以未 instrument 的子行程驗證，Stryker 無法把它判成 killed，需後續以可 instrument 的 direct-run fixture 決定。

## 補的測試

只修改 `scripts/check-doc-links.local.test.ts`，新增 15 個案例（focused suite 最終 85 passed）：

- `GATES_CONFIG_DIR` 的 `skipPrefixes`：巢狀路徑與精確命中檔案。
- 缺省 `skipDirs`、錯型 `docLinks` 欄位、陣列內非字串項目。
- 錯型 `skipDirs` / `docLinks` 的 CLI FAIL 訊息。
- 多空白 title、單邊角括號、無副檔名 backtick、冒號前綴假路徑。
- backtick 路徑統計、不同長度/未配對反引號、反斜線輸出正規化。

## NoCoverage（6 個，另列不分類）

這些分支是 module-level direct-run 或額外 undefined fallback；測試以 `spawnSync` 啟動未被 Stryker instrument 的子行程，因此沒有 coverage：

- `check-doc-links.ts:417:59` StringLiteral：`lines[i] ?? ''` → `"Stryker was here!"`。
- `check-doc-links.ts:560:72` BooleanLiteral：`?? false` → `?? true`。
- `check-doc-links.ts:561:18` BlockStatement：CLI block 清空。
- `check-doc-links.ts:562:33` MethodExpression：`main(process.argv.slice(2))` → `main(process.argv)`。
- `check-doc-links.ts:563:3` CallExpression：移除 `console.log(output)`。
- `check-doc-links.ts:564:3` CallExpression：移除 `process.exit(code)`。
