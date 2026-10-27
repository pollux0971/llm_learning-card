# T65 紅測試驗收證據(05-grading phase-3:縮短版生成)

- 工單:T65(`docs/tickets/T65-grading-phase3-short-and-queue.md`)
- 被驗分支:`t65-red` tip `2bf9d8e3093abb0fa9a38e56249c22d185c5214f`,基底 `t65-chore` `2ebc05bad7a4481fc62aa2c7bad62d7ef2666a92`
- tree sha(筆電與 i9 同):`c756db66438a87fcbc8fcdb6d6647ef8e941df70`
- 日期:2026-10-27。乾淨簽出(`git worktree add --detach`),兩邊 `ls .env` 都是 No such file,i9 `npm ci`。
- 範圍:7 檔 +869/-1(單元 48、import 守門 5、步驟 3 場景加共用接縫、`t31-static` 25→26)。

## 1. 測試作者與不動的地方

- 這個分支只有 1 個 commit,作者是測試 agent 帳號;沒有實作檔(`reteach-short.ts`、prompt、index 都沒有)。
- `t31-static` 的 26 與 `boundaries.allow.json` 實際條數 26 一致(含 `05-grading → 02-ingest-pipeline` 那一條)。

## 2. 基底(沒有實作)

| 項目 | 結果 |
|---|---|
| `tsc`(typecheck) | 乾淨(動態 import 算出的 file URL) |
| `boundaries` | 過(scanned 404) |
| 單元 `reteach-short.test.ts` | **48 條全紅**;38 條原因是「找不到 `reteach-short.ts`」,其餘 10 條是「prompt 範本檔不存在」或依賴它的斷言。原因都是「功能還沒有」,不是測試寫壞 |
| import 守門 5 條、`t31-static` | 基底本來就綠(守的是將來不准 import 的東西;壞樣本 15 個 + 好樣本 9 個證明抓得到) |
| cucumber `@grading and @phase-3 and not @manual`(i9,空 HOME) | **3 場景全紅**(`Cannot find module …/reteach-short…`;16 步:4 過、3 敗、9 跳過) |
| 乾跑 `cucumber-js --dry-run --tags 'not @manual'` | 787 場景,64 undefined(之前是 67 個非 pass:3 個 phase-3 場景現在有定義了),**沒有 ambiguous** |

## 3. 我自己的丟棄式實作(不進 git、已刪)

我自己從工單寫了一份 `generateShort`(約 70 行)加一個 prompt 檔、`index.ts` 多一行匯出,**沒有看 -a6 的**:

- 單元 `reteach-short.test.ts`:**48/48 綠**。
- cucumber `@grading and @phase-3`:**3/3 場景、16 步全過**(i9)。
- 守門 5 條、`t31-static`、`typecheck`、`boundaries`:綠(i9)。
- **7 條 prompt-quality 測試變紅**(`cli.test`、`registry.test`、`registry-t55.test`):它們要求「每個 prompt 檔都登記在某組 golden set」。我的丟棄式實作沒登記 registry,所以紅。見第 6 節「缺口 G1」。
- 不退步(i9,有我的實作,空 HOME):`@grading and @phase-2` 9/9、`@llm-router and @phase-3` 8/8、`@integration and @i1` 9/9、`@teach-card and @phase-3` 8/8;`@grading and not @manual and not @llm` 38 場景:32 過、1 敗、5 undefined——那 6 個是 05 phase-4(之後做),第一個場景的敗因是 07 phase-3 的定義搶走那句話(工單已記,不是這張造成)。
- 跑完空 HOME 底下沒有多出 `llm-learning-cards` 快取資料夾。

## 4. 自選改壞(對我的丟棄式實作,36 個;單元檔 48 條)

**紅(抓到)**:34 個。對應工單 must_catch:

| 工單項 | 我的改壞 | 結果 |
|---|---|---|
| 夠短就停 | 不提前停;`<=` 改 `<` | 29 紅 / 3 紅(「正好等於上限也算」那條) |
| 留最短 | 留第一個 / 最後一個 / 最長 | 3 / 2 / 4 紅 |
| 字數量讀回的 body | 改量 body 加 example | 5 紅 |
| 來回檢查 | 拿掉 examples 剛好 1 個的檢查;改成 ≥ 1 | 2 紅 / 2 紅 |
| 空欄位 | 拿掉 body trim 檢查 / example trim 檢查 / example 只擋空字串 | 3 / 2 / 1 紅 |
| 非字串 example | 放行 | 2 紅 |
| 重試 prompt | 沒有「上一次 N 字」那行 / N 錯成上限 / N 一直是第一次 | 1 / 1 / 1 紅 |
| prompt 內容 | 不帶 examples / 不帶上限 | 2 / 1 紅 |
| NO_MODEL 第 2 次 | 有好的也繼續試 / 沒好的也不回 no-model | 2 / 2 紅 |
| 其他錯誤原樣丟 | 吞掉改成 continue | 3 紅 |
| 佇列記哪一次 | 記最後一次的 prompt 與回應 | 1 紅(「三次都本機、留第 1 次」那條) |
| 佇列 | 永遠 enqueue / 從不 enqueue / 先 enqueue 再寫檔 | 3 / 6 / 1 紅 |
| 檔案標 provisional | 不標 | 2 紅 |
| 次數 | attempts 固定 3 / 少 1;迴圈改 2 或 4 次 | 23 / 30 / 10 / 8 紅 |
| warning | 失敗不記 / 夠短也記 overlong / reason 改名 / 不帶字數 | 1 / 3 / 1 / 1 紅 |
| 寫檔 | 路徑少一層分類 / 不用 writeFileAtomic | 31 / 1 紅 |

**存活(2 個)**:

- **M07 量原始 body 的字數(不是讀回的)**:48/48 仍綠。一般輸入兩邊字數一樣,但有一種輸入會分出來——body 末尾有**沒關的 example 圍欄**。我實測:原始 body 41 字,renderCardFile 組出來再讀回,examples 剛好 1 個(圍欄吞掉了真的 example)、讀回的 body 只剩 10 字。工單的來回檢查只看「examples 剛好 1 個」,這個輸入會**通過檢查**,寫出一份 example 內容是垃圾的縮短版。→ 缺口 G2。
- M34 字數相同時留後一次:工單沒規定平手怎麼辦,等價,不算缺口。

## 5. import 守門(`t65-grading-imports.test.ts`)額外探測

用同一個 `badIngestImports` 對我加的樣本探測:

- 抓到:`export * as … from`、模板字串無替換的動態 import、路徑裡有 `../ingest/../ingest/…`、`card-file.js?raw`(多了查詢字串,算不是 card-file,擋下,保守是對的)。
- **漏掉**:有替換的模板字串動態 import(`` import(`../ingest/${name}.js`) ``),和 JSDoc 型別裡的 `import('…')`。→ 缺口 G3(低)。
- 兩句撞名的 tag 分派(`the network is available` / `unavailable`):`isGradingPhase3` 要 `@grading` 與 `@phase-3` 兩個 tag 都有;03 的 `isLlmPhase3` 排在前面。`unavailable` 的分派被場景 3 守住(拿掉會進 i1 的離線路徑,場景 3 紅)。`available` 那一句即使拿掉也一樣(預設就是在線),所以那個 hook 拿掉不會紅,是等價,不是缺口。同一次 cucumber 裡 03 phase-3(8/8)、07 phase-3(8/8)、i1(9/9)照常過,證明沒搶到別人的。

## 6. 缺口(給 -a6 / 顧問;其中 G1 擋)

- **G1(擋)——golden 輸入與 `--fake` 回應沒交。** 工單說「輸入與 `--fake` 回應由測試 agent 寫」,驗收條件也有 `prompt-check --golden --set reteach.short` 退出碼 0。這個分支沒有任何 golden 檔,也沒有 `registry-t65` 之類的測試。後果:worker 一旦加 `reteach-short.md`,現有的 prompt 檔守門(7 條,見上)會立刻紅,而 worker 又不能自己寫 golden 輸入(受保護)。要補:`reteach.short` 這組的三個輸入、`--fake` 回應、對應的 registry 測試(照 T55 的 `registry-t55.test.ts` 做法)。
- **G2(建議補一條,不擋)——來回檢查要再加一條。** 加一條單元:body 帶**沒關的** example 圍欄(例如 8 個字加一行 example 圍欄開頭、後面接 30 字,沒有結尾圍欄),應該算格式壞(或實作應比對讀回的 body 與 example 跟模型給的一致)。目前只有「圍欄有關」的那條。
- **G3(低)**:import 守門對有替換的模板字串動態 import 與 JSDoc import 型別不判。目前 grading 底下沒人這樣寫,不擋。

## 7. 副作用與花費

- `learning/`:64 檔 / `01d84e9c918e1cf4` / 帳本 111 行,前後相同。筆電 `~/.cache/llm-learning-cards` 頂層 497,前後相同。
- LLM 花費 0。i9:一次 `npm ci`、4 個 cucumber 子集加 1 個 base,輕到中。
- 暫存都清了:i9 簽出、暫存分支、暫存 ref、暫存 HOME、丟棄式實作檔;筆電簽出的丟棄式實作也已刪(`git status` 乾淨後才開這個證據分支)。

## 結論

有阻擋項:G1(golden 輸入與 `--fake` 回應沒交,registry 測試也沒有)。其餘單元、步驟、守門的紅測試本身通過:基底全紅且原因正確,獨立實作 48/48 與 3 場景全綠,36 個改壞抓到 34 個,存活 1 個是缺口(G2)、1 個等價。
