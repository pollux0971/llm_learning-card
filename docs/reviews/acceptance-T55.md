# T55 實作驗收證據

被驗分支 t55-impl,提交 d2bb519329b859e6bd137b7e8bc2ba8d91901769(起點 t55-start 59cc3bb)。被驗樹 sha(tree):8f571c372f09ca0f0861dad1e5e916f8c953abeb(含本證據分支多加的變異設定檔前;實作檔相同)。日期 2026-10-26。工單:`../tickets/T55-ingest-topic-generation.md`。

## 範圍(第 1 點)
- 對起點的差異 7 檔加 508 行:`topic.md`(新)、`index.ts`(+1)、`scan.ts`(+30/−8)、`topic.ts`(新 324 行)、`registry.ts`(+33)、`types.ts`、報告 `T55-implementation.md`。
- 沒有測試檔、步驟、fixture、`.feature`;工單「不動的地方」那條 diff 輸出 0 行(contracts、features、standalone.json、cards/questions/children/regenerate/deps 五個 prompt、schema、scheduler 都零差異);其他 prompt 一個位元組都沒動。
- 沒有 `.env`;報告與實作裡沒有真的 `raw/`、`learning/` 檔名或內容。

## 靜態與測試(第 2 點;i9,`VITEST_MAX_WORKERS=1`)
- `tsc --noEmit` 乾淨;`npm run boundaries` PASS(397);`npm run check:steps` PASS;doc-links PASS(154)。
- `packages/core` 131 檔、**2928 條全綠**(含 t55 兩檔、registry-t55、t53 全部)。
- cucumber 全綠:`@ingest-pipeline and @phase-3` **8/8 場景**(場景 2 現在有實作且綠);`@ingest-pipeline and not @phase-3 and not @manual` 29/195;`@prompt-quality and @phase-2 and not @manual and not @live` 22/85;`@i1 and not @manual and not @llm and not @e2e` 78/329。
- 手動跑 CLI(筆電,假 router):分類沒設定 → 印「沒有定義」退出碼 1。分類存在但假 router 沒有預錄回應 → 見下方「行為備註 1」。

## 變異(第 3 點;i9,全分母)
- `stryker.t55-topic.json`(`topic.ts` 加 `scan.ts`;測試 `t53-*`、`t55-*` 共用 glob):**79.81%**(殺 582、逾時 3、存活 148、共 733)。`scan.ts` 87.65%(存活 62)、**`topic.ts` 62.77%**(存活 86)。**低於 80%,是阻擋項。**
- `stryker.t53-scan.json`(T53 原範圍 `scan.ts` 加 `init.ts` 第 48–62 行,只用 t53 測試):**85.38%**(`scan.ts` 85.06%、`init.ts` 94.44%)。比 T53 上次的 87.48% 低,原因是 `scan.ts` 多了主題生成呼叫那幾行,只有 t55 測試才涵蓋;合併 t53 加 t55 測試的 `scan.ts` 是 87.65%,所以舊部分沒有退步。
- i9 meta:開跑 18:33(load 0.65,40°C 級),`t53` 與 `t55` 兩個設定同時跑(Stryker 鎖讓它們依序),跑完 19:11,load 約 4。

### `topic.ts` 存活 86 個的歸類
| 類 | 約個數 | 內容 | 判斷 |
|---|---|---|---|
| 模型回應格式檢查(`parseTopicCards`,107–116 行) | 約 20 | 回應不是 JSON、不是陣列、元素缺 title/body、examples 的過濾 | **真缺口(中)**:沒有任何測試給壞掉的回應 |
| 後半失敗的處理(202–234 行) | 約 30 | 子卡失敗、考題失敗、依賴圖失敗只記 warning 不中斷;`GraphFileCorruptError` 要往外丟 | **真缺口(中)**:行為對照 raw 管線,但沒有測試 |
| 重試事件(287、315–316 行) | 約 11 | 超長 body 重試成功時要記 `regenerate` 事件 | 真缺口(低) |
| 探測丟例外(243 行,`catch` 回 `true`) | 1 | 探測丟例外要當離線 | **真缺口(中)**:我獨立手改壞也存活(見 N4);T53 的 raw 路徑有這條測試,主題路徑沒有 |
| 卡 frontmatter 的 `provisional`、`stale`、`source_missing`(165–167 行) | 3 | 新卡這三個旗標必須是 false | 真缺口(低到中) |
| `today` 預設(303 行) | 1 | 沒給 today 時 `created` 要是日期,不是完整時間戳 | 真缺口(低) |
| prompt 組裝的分隔與行(95 行) | 5 | `---`、`category:`、`topic:` 各行 | 真缺口(低):現在只測「prompt 含主題」 |
| needs-review 的 `source`、`reason`(141、142 行) | 2 | 暫緩紀錄欄位 | 低 |
| 純措辭(30、108、110、114、182、213、222、234、251、260、300、323 等) | 約 15 | 訊息文字 | W:不計 |
| 等價 | 約 4 | `utf8` 編碼字串(83)、`kept` 的 `>` 與 `>=`(270,最多 5 張時 `slice(0,5)` 無差別)、`isPlainObject` 的短路等 | 同意等價 |
| `isTopicKey`(72、73 行) | 2 | 見「第 6 點」 | 見下 |
不扣任何類,全分母 79.81%;只扣純措辭與等價約 19 個,是 82% 上下,但真缺口仍在,結論不靠扣分。

## 手改壞(第 4 點,不在 a6 與我上次的清單,筆電跑 t55 加 t53-scan 加 golden 登記的測試,每個還原後乾淨)
| 編號 | 改法 | 結果 |
|---|---|---|
| N1 | 剛好 5 張也記 warning(`>=`) | 紅 1 |
| N2 | 超過 5 張不記 warning | 紅 1 |
| N4 | 探測丟例外當在線 | **存活(真缺口)** |
| N7 | 卡的 `prereqs` 不是空陣列 | 紅 4 |
| N8 | `processedAt` 空字串 | 紅 1 |
| N9 | `ingested` 事件的 `cards_created` 多 1 | **存活(低)** |
| N10 | 拿掉 `regenerate` 事件 | **存活(低)** |
| N11 | `levelZeroOnly` 被忽略(一律跑後半) | 紅 1 |
| N12 | 暫緩的卡不記錄 | 紅 1 |
| N13 | prompt 用沒正規化的主題 | 紅 24 |
| N15 | 有 raw 時也走主題生成 | 紅 4 |
| N16 | 要求 raw 的分類不拒絕 | 紅 4 |
| N17 | 主題鍵不含分類 | 紅 3 |
| N18 | 上限改 4 | 紅 3 |
| N19 | 空主題不拒絕 | 紅 3 |
共 15 個(另有 N20 是無行為差異的改寫,不計):12 紅、3 存活(N4、N9、N10),都對到上面變異的真缺口。

## `topic.md`(第 5 點)
- 照抄 `cards.md` 能抄的部分:body 上限 100 字與字數規則(含「same-origin 算 2、1.3 算 2」)、一張卡一個概念、examples 給具體案例不重複 body、只回傳 JSON 陣列、不要說明文字。不同的:輸入是一行主題、1–5 張、不要 `lines`、只寫公認知識、不確定的不寫、不編造數字出處。
- 沒有 `lines`、沒有資安字樣、沒有真資料。登記到 `ingest.topic` 的三個輸入由 registry-t55 的測試把關(都綠)。

## 第 6 點:`isTopicKey` 由哪條測試守
- 掃描迴圈有兩道防線:T55 新加的 `isTopicKey` 略過,以及 T53 本來就有的 `isDirectRawKey`(只認 `raw/<分類>/<檔>` 開頭的鍵)。
- 只拿掉 `isTopicKey` 略過:全綠(等價,上一輪也是這個結論)。只壞 `isTopicKey` 本身(`startsWith` 改 `endsWith`、函式本體清空):也全綠(變異 72、73 行存活)。兩道一起壞,T55 S「先主題、後掃描:掃描不碰主題卡」(兩條)與 T53 extra「別的分類的鍵」會紅。
- 結論:**守的是 T55 S 那兩條,但只有兩道防線同時壞才會紅**;實作的註解寫「兩道都要在」,沒有測試強制「`isTopicKey` 這一道單獨存在」。因為行為等價,不擋,記一筆。

## 行為備註(不在工單明文,供顧問裁)
1. **模型回壞掉的回應、或 `router.call` 丟錯(例如沒有雲端):`generateFromTopic` 沒有 try/catch,例外一路往外丟,CLI 印整串堆疊、退出碼 1**(我手動跑確認)。工單只明文「0 張或全部暫緩 → 失敗,退出碼 1」。使用者看到的是堆疊而不是一句話;raw 路徑的同類情況有明確訊息。建議包成 `topic_failed` 加一句說明,並補測試(同時補上變異的 107–116 行)。
2. 子卡、考題、依賴圖的失敗在後半只記 warning(同 raw 管線的作法),但完全沒有測試(變異 202–234 行)。

## 其他
- `learning/` 前後:64 檔 / `c2e4dd6d71de3976` / 108 行,相同。
- 花費:worker 6.60 美元(只記錄,grok 不設限);預算 2 美元,比值約 3.3 倍,**超過 2 倍**(工單說 grok 不設停止線只記錄)。真呼叫的 golden run 不是這一輪的事,由協調者在主簽出跑。

## 結論
有阻擋項:變異分數 79.81%(全分母)低於 80%,而且 `topic.ts` 只有 62.77%;原因是真的測試缺口(壞回應、探測丟例外、後半失敗處理、重試事件、卡旗標、today 預設、prompt 組裝)。其餘全部通過:範圍乾淨、全套 2928 與四組 cucumber 全綠、T53 原範圍變異沒退步(85.38%,合併範圍的 `scan.ts` 87.65%)。建議測試 agent 補測後重跑變異;實作建議把壞回應與丟錯包成 `topic_failed`(行為備註 1)。

## 實作第二輪驗收(被驗分支 t55-impl2,提交 a8f67a366bbf1c8b7c9c99dfb3f6e4a072cb7166;疊在 t55-red2 8b2bc6f 上)

被驗樹 sha(tree):d44f33c488376b34b8fc180a293bf8726b4bf83a(含驗收用變異設定檔,實作檔相同)。日期 2026-10-26。

### 範圍(第 1 點)
- 對 t55-red2 的差異只有 `topic.ts` 與 `T55-implementation.md` 兩個檔;沒有測試、fixture、`.feature`、`scan.ts`、`scripts/ingest.ts`、prompt 的改動。沒有 `.env`。
- `tsc --noEmit` 乾淨;`npm run boundaries` PASS(398);`npm run check:steps` PASS;doc-links PASS(154)。

### 測試(第 2 點;i9)
- `packages/core` 132 檔、**2959 條全綠**(含 t55 全部與補測 31 條)。
- cucumber 全綠:`@ingest-pipeline and @phase-3` 8/8;`@ingest-pipeline and not @phase-3 and not @manual` 29/29;`@prompt-quality and @phase-2 and not @manual and not @live` 22/22;`@i1 and not @manual and not @llm and not @e2e` 78/78。

### try/catch 的範圍(第 3 點,讀程式)
- 只包第一段:`router.call` → `parseTopicCards` → 逐張 `enforceWordLimit`(含重生呼叫);失敗在寫任何東西之前返回(`logWarning`、`writeParked`、寫卡、`ingested.json` 都在 catch 之後)。
- 後半(寫卡的 fs 錯誤、`validateCard` 失敗、`GraphFileCorruptError`)在 try 外面,照丟。雲端錯看 `code === 'CLOUD_REQUIRED'`,不看 class name,走與離線相同的訊息加 `cloudBlocked`;其他錯回 `topic_failed` 加錯誤第一行,不帶堆疊。
- 註:第一段裡的程式錯誤(例如解析時的 TypeError)也會變成 `topic_failed`,不再往外丟;這是工單與補測要的(壞回應 = 失敗),不算吞 bug。

### 變異(第 4 點;i9,全分母,沒有排除任何變異種類)
- 在 i9 跑:開跑 19:44(load 約 0.6),跑完 20:23(load 約 4);兩個設定同時排隊(Stryker 鎖讓它們依序)。
- `stryker.t55-topic.json`(`topic.ts` 加 `scan.ts`):**85.01%**(殺 649、逾時 3、存活 115);`topic.ts` **80.00%**(殺 210、逾時 2、存活 53)、`scan.ts` 87.65%(存活 62)。上一輪 79.81%(topic.ts 62.77%)。
- `stryker.t53-scan.json`:**85.38%**(`scan.ts` 85.06%、`init.ts` 94.44%),與上一輪完全相同,不退步。

### `topic.ts` 存活 53 個的歸類(獨立核)
| 類 | 約個數 | 內容 | 判斷 |
|---|---|---|---|
| W 純措辭 | 約 14 | 各訊息文字(30、108、110、114、147、182、261、268、277、305、327、350 行等) | 同意,純文字 |
| 等價 | 約 24 | `utf8` 編碼字串(83);預設陣列被蓋掉(91、202、203);`isPlainObject` 的子條件(99,後面還有 title/body 型別檢查);探測 `catch {}`(242,初值已是 false);雲端錯判斷的型別前置條件(249,字串型的丟出值沒有 `code`);`trim`、空訊息的備援字串(254、261);`>` 與 `>=`、`true`(295,最多 5 張時 `slice(0,5)` 無差別);`!check.ok || !check.card`(181,通過時一定有 card);`JSON.parse` 失敗的 `catch` 空塊(107,後面的陣列檢查仍會丟,只是訊息不同) | 同意 |
| 真缺口(低) | 約 14 | prompt 組裝的分隔與行(95 行 5 個);暫緩紀錄的 `source`、`reason`(141、142);`examples` 的過濾(116 行 3 個:非字串的 example 被丟掉);重試警告轉進 log 的 `file`(308、323);`isTopicKey`(72、73,已知兩道防線冗餘,不擋) | 都是低風險,不擋 80% |
沒有任何行為類缺口留在前半失敗處理、雲端錯、探測丟例外、後半失敗、重生事件、卡旗標、today 預設。

### 手改壞(第 5 點,對 impl2,筆電跑 t55 加 t53-scan,每個還原後乾淨)
| 編號 | 改法 | 結果 |
|---|---|---|
| S1 | 雲端錯當一般錯 | 紅 4 |
| S2 | 雲端錯只看 class name | 紅 2 |
| S3 | 說明帶整段多行訊息 | 紅 2 |
| S5 | 寫卡的 fs 錯誤也被吞成 topic_failed | 紅 1(P 組) |
| S6 | `GraphFileCorruptError` 被吞 | 紅 1(P 組) |
| S8 | 失敗不標 `topic_failed` | 紅 16 |
| S9 | 失敗時多記 warning(寫了東西) | 紅 20 |
| S10 | 壞 JSON 吞成空陣列 | **存活**(結果仍是 `topic_failed`,只是說明變成「沒有可用的卡片」,屬措辭,低) |
| S11 | 驗證失敗被吞 | 紅 1(P 組) |
| S12 | 空訊息備援字串拿掉 | 存活(等價,措辭) |
| S13 | 第一行不 trim | 存活(等價,措辭) |
| S14 | 離線時 `cloudBlocked: false` | 紅 6 |
共 12 個:9 紅、3 存活(都是措辭或等價)。

### 其他
- `learning/` 前後:64 檔 / `c2e4dd6d71de3976` / 108 行,相同。
- 花費:worker 累計 10.96 美元(只記錄,grok 不設限),預算 2 美元,比值約 5.5 倍,超過 2 倍;真呼叫的 golden run 不是這一輪的事,由協調者在主簽出跑。

### 結論(實作第二輪)
通過。範圍乾淨;全套測試與四組 cucumber 全綠;變異 85.01%(全分母,`topic.ts` 單檔剛好 80.00%),T53 範圍 85.38% 不退步;try/catch 只包第一段,後半的程式錯誤與 fs 錯誤照丟,雲端錯看 code。剩下的存活點是措辭、等價或低風險。
