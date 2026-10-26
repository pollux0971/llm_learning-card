# T55 紅測試驗收證據

被驗分支 t55-red,提交 4bc643ef963b01c60f044353101b85632db94fb7(基底 main e95ec43;第一個提交 0500c7a 加上規格小修 4bc643e)。
被驗樹 sha(tree):7d5c3aa040a7b61401d9bfd77af9a08ee7b4b1db。日期 2026-10-26。工單:`../tickets/T55-ingest-topic-generation.md`。

## 範圍
- 差異 16 個檔加 1 個規格小修,共 19 個檔:全是測試、步驟定義、fixture、`.feature` 一個字。沒有 `prompts/`、`registry.ts`、`types.ts`、`scan.ts`、`init.ts`、`scripts/`、`contracts/` 的改動(逐一 grep 差異檔名,零命中)。
- 測試作者:兩個提交都是測試 agent 這條線。
- 沒有 `.env`;`tsc --noEmit` 乾淨;`npm run boundaries` PASS(396);`npm run check:steps` PASS(1297 個定義無重複)。

## 既有測試前提的改動,逐條判斷
| 改動 | 判斷 | 理由 |
|---|---|---|
| t53-cli:刪「不要求 raw、沒有 raw、給主題 → 退出碼 1、印『還沒做』」 | 必要 | 工單把這條行為換成真的主題生成;新行為由 t55-topic-cli 與 t55-topic-generation 的生成、不合法、重複各條接手,不是刪掉了事 |
| t53-scan-routing:刪「topic_not_implemented、LLM 0、什麼都不寫」,留註解 | 必要 | 同上;檔頭原本就寫「T55 接手時這一條會被換掉」 |
| t53-scan-extra:拒絕清單拿掉 `{category:'peach', topic:'x'}` | 必要 | peach 加主題不再是拒絕;清單剩下的兩種拒絕斷言一個字沒動。註:新的 `topic_invalid`、`topic_failed` 拒絕的「所有桶都是空」沒有被斷言,是小缺口,不擋 |
| t53-test-support:`Refusal` 加兩值、結果加兩個可選欄位 | 必要 | 只加型別 |
| registry.test(五→六個檔、六→七組、輸入數表加 ingest.topic、「五組吃 raw 的」過濾掉 topic) | 必要 | 數量隨新增一組而變;「輸入來自 raw 切片」那條對 ingest.topic 本來就不成立(輸入是一行主題),改由 registry-t55 的三個主題條接手,不是放寬 |
| prompt-quality/cli.test(21→24 個輸入、六→七組、行號平移) | 必要 | 同上,數字是新增一組的必然結果 |
| prompt-quality-phase2.steps 與 12 phase-2 的 `.feature`(five→six,5→6) | 必要 | 守門數的是 prompt 檔個數,新增 `topic.md` 後必為六;`.feature` 小修是顧問批准的規格小修。基底上這一步紅的原因是 5 對 6 |
結論:五類改動都是必要的行為改變或數量更新,沒有放寬。

## 基底紅綠(t55-red 原樣,無實作)
- 筆電,`VITEST_MAX_WORKERS=1`,範圍 `packages/core/src/ingest/t53*`、`t55*`、`packages/core/src/prompt-quality`:35 檔、598 條,**39 紅、559 綠**(與測試 agent 報的 39 紅相同)。紅的全是主題生成的新行為、登記表與 `topic.md` 的缺、`--list` 與 `--golden --fake` 的計數;原因都是「功能還沒有」。
- cucumber(在 i9):`@ingest-pipeline and @phase-3` 8 個場景 1 紅 7 綠,紅的是「A category that allows generation produces from a topic」,步驟「between 1 and 5 level zero cards are written」;`@prompt-quality and @phase-2 and not @manual and not @live` 22 個場景 1 紅,紅的是「six ingest prompt files」那步(5 對 6)。

## 丟棄式實作證明可轉綠(不進 git,已刪)
- 我請子代理寫丟棄式實作(新增 `topic.ts`、`topic.md`,改 `ingest.ts`、`scan.ts`、`index.ts`、`registry.ts`、`types.ts`、`scripts/ingest.ts`),我自己重跑驗證。
- 筆電:ingest 與 prompt-quality 55 檔、**1019 條全綠**(基底 39 紅)。
- i9(`npm ci` 後,`VITEST_MAX_WORKERS=1`):`packages/core` 131 檔、**2928 條全綠**。
- i9 cucumber 全綠:`@ingest-pipeline and @phase-3` 8/8(34 步);`@ingest-pipeline and not @phase-3 and not @manual` 29/195;`@prompt-quality and @phase-2 and not @manual and not @live` 22/85;`@i1 and not @manual and not @llm and not @e2e` 78/329。
- 在 i9 跑:開跑 18:00,load 約 0.4,跑完 18:04,load 約 0.9。

## 手改壞(我自己的,對丟棄式實作;測試範圍 t55 全部加 t53-scan 各檔;每個跑完還原)
| 編號 | 改法 | 結果 |
|---|---|---|
| L1 | 張數上限 5 改 6 | 紅 1(回 6 張那條) |
| L2 | 卡寫出 `source_ref` | 紅 4 |
| L3 | 重跑不略過(`existing` 判斷關掉) | 紅 3 |
| L4 | 掃描迴圈拿掉 `isTopicKey` 略過 | **存活**(見下) |
| L4b | `isDirectRawKey` 拿掉分類前綴檢查 | 紅 1(T53 的「別的分類的鍵」那條) |
| L4c | L4b 加拿掉 `isTopicKey` 略過 | 紅 3,含 T55 S「先主題後掃描」那條 |
| L5 | 記主題的 sha 用沒正規化的主題 | 紅 3 |
| L6 | 拿掉長度上限檢查 | 紅 4(201 字元那條) |
| L7 | 長度用 UTF-16 而非 code point | 紅 1(表情 200 個那條) |
| L8 | 不做 NFC | 紅 2 |
| L9 | 卡 level 改 1 | 紅 8 |
| L10 | `created` 寫死 | 紅 1 |
| L11 | 已生成過的訊息不列卡 id | 紅 1 |
| L12 | 記下的 sha256 欄位寫錯 | 紅 1 |
| L13 | 空主題不拒絕 | 紅 3 |
| L14 | 0 張卡不算失敗 | 紅 2 |
| L15 | 超過 100 字的 body 不走重試,直接寫原文 | 紅 1 |
| L16 | 不併連續空白 | 紅 5 |
| L17 | 不 trim | 紅 6 |
| L18 | 不寫 `ingested.json` | 紅 7 |
| L19 | 不探測(直接當在線) | 紅 1(離線那條) |
**L4 存活的判斷:** T53 的 `isDirectRawKey` 本來就會拒絕不以 `raw/<分類>/` 開頭的鍵,所以只拿掉明確的 `isTopicKey` 略過不改變行為,屬於等價。兩道防線一起拿掉(L4c),「先主題後掃描」那條就紅了,工單的這條 `must_catch` 因此有人把關。

## 工單 `must_catch` 對照
- 分類要求 raw 仍照主題生成 / 分類有 raw 拿主題生成:T53 的 requires_raw 與 raw 優先既有條 + T55 對照條(有 raw 又給主題,topicGenerated 空),實作都綠。
- 寫出的卡 source 不對、有 source_ref、不是 level 0、沒考題檔:L2、L9 紅;考題檔在 G 與 cucumber 場景 2 都看。
- 卡數 1 到 5:L1、L14 紅;body 超過 100 字:L15 紅;重跑又生一批:L3 紅;掃描當 raw 路徑:L4c 紅;正規化空或超過 200:L6、L13、L7 紅。
- 記主題用了新檔:T 組的「state/ 底下沒有新檔」條,只比對檔名集合;L18 紅。
- 其餘(prompt 沒跑 golden、花費記錄、日上限、動到 touches 以外的檔、變異分數)屬實作後的驗收,這一輪不驗。

## fixture
- 三個主題(光合作用、複利、Git 分支與合併)是公開常識,不取自 `raw/`、`learning/`、帳本;`grep` 這三個 fixture 與 `topics.json` 沒有 `raw/` 或 `learning/` 字樣。
- sha256 釘在 `registry-t55.test.ts`,我重算四個檔(`topics.json` 與三個 `--fake` 回應)全部相符。
- `--fake` 回應的 `prompt_contains` 是 `golden: topic-<key>`,三個互不為子字串;`attempt` 為 1;每個回應 3 張卡、字數過 100、沒有 `lines`、title 不重複。

## 讀測試的備註(不擋)
- `topic.md` 本身的內容只被測「存在、超過 200 字元、含『主題』」;prompt 好不好由 golden run 與顧問評分管,測試不假裝管。
- `t55-test-support.ts` 只有假 router 與小工具,沒有接近完整的實作。
- `t55-topic-cli.test.ts` 只測不需要 LLM 的兩種情況(不合法、已生成過),`--fake` 回應檔不新增;實作後 CLI 走到 LLM 的路徑只由單元測試的 router 版本覆蓋。
- 副作用目標(寫檔、刪檔)都在 `makeLearning()` 的暫存資料夾,沒有真的 `learning/` 路徑。

## 資料前後
- `learning/`:64 檔 / `c2e4dd6d71de3976` / 108 行,前後相同。

## 結論
通過。紅測試只動測試、步驟、fixture;既有測試的前提改動全是必要的行為改變,沒有放寬;基底 39 紅、丟棄式實作 145 條所在範圍全綠;手改壞 21 個除一個等價外都紅。
