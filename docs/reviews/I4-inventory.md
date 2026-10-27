# I4 盤點:兩張卡完整這個整合點現在在哪裡(2026-10-27)

> 作者:協調者。判定:技術顧問(2026-10-27 派)。
> 被盤點:origin/main `1652811`(tree 與 i9 簽出同),不含本檔。
> 做法照 [I3 盤點](I3-inventory.md):i9 乾淨簽出、空 HOME、沒有 `.env`,跑 `@i4 and not @manual` 的 cucumber(先 `--dry-run`,再真跑)。
> 依據:`../integration/i4-two-card-system.feature`、`../01-roadmap.md` 的 I4 段落、ADR-073、ADR-077、ADR-079、ADR-080。

## 結論

- **I4 要的四個 phase 都 `done`**:07-teach-card phase-2(2026-10-23)、phase-3(2026-10-24)、phase-4(2026-10-25)、02-ingest-pipeline phase-3(2026-10-26)。
- **i4 整合檔 10 個場景**:7 個自動場景**步驟全是 undefined**(45 條步驟,背景三條每個場景都算),0 紅;3 個 `@manual`(其中 1 個 `@e2e`)要人做。跟 I3 盤點時的形狀一樣:行為由各 phase 的場景守著、真跑全綠,整合層只缺步驟定義。
- **標了 `@i4` 的場景,真跑 30 個:23 過、7 undefined、0 敗**。23 個全是各 phase 檔自己的場景(02 phase-3、07 phase-2/3/4);7 個 undefined 就是整合檔的 7 條。
- **roadmap 的整合工作「07 接上真的 fs、order 檔、llm-router、scheduler」大致做了**,不是在 I4 才做,是 T37/T40/T43/T44(ADR-077、ADR-079):教學卡的判斷與寫入跑在側車裡,用同一份 core(真 fs、`graph/order-*.json`、`createLiveGatewayRouter` 經 02 的生成、scheduler 的卡片狀態)。**沒有單獨一張「整合工作」工單,也沒有整合層的測試證明這件事**(下面第 2 節)。
- **建議**:開 **1 張整合工單**,補 7 條場景的步驟定義(同 T34 的做法),不新增產品行為。是否要第二張、以及三條人工確認怎麼問使用者,交顧問判(第 3、4 節)。
- **I4 照 ADR-073 的 gate**:I2 的 `@e2e`/`@manual`「連用一週」與 I3 的 `@e2e @manual`「在視窗裡完成一輪複習」都延到 I4,**要問使用者**(第 4 節)。I2、I3 都不打 tag,I4 通過前補完才打 `I2` tag。
- **I4 卡著的下游**:06-test-card phase-4(縮短版重教)與 I5。05 phase-3(縮短版生成)已 done,所以 06 phase-4 現在只剩 I4 一個 gate。

## 1. 量測條件

- host:i9(ssh 別名 mint),`/tmp` 底下的臨時簽出,HOME 指暫存、`XDG_CACHE_HOME`、`XDG_CONFIG_HOME` 沒設,`RUSTUP_HOME`/`CARGO_HOME` 指回真的(空 HOME 的 cargo 起不來);`CARGO_BUILD_JOBS=2`。簽出裡沒有 `.env`。
- 指令:`NODE_OPTIONS=--import=tsx npx cucumber-js --tags "@i4 and not @manual"`(先加 `--dry-run`)。
- 乾跑 2 秒;真跑 1 分 16 秒(19:39:53–19:41:09),退出碼 1(因為有 undefined)。
- 結果:`30 scenarios (7 undefined, 23 passed)`、`163 steps (45 undefined, 4 skipped, 114 passed)`。
- 跑完 HOME 底下只剩 `.npm`(T64 的快取封閉在起作用);簽出與暫存目錄已刪(只刪自己 mktemp 的);`git worktree list` 只剩主簽出。
- 這次沒碰 `learning/`,沒有 LLM 呼叫,沒用 `--live`。

## 2. 十個場景逐條

`../integration/i4-two-card-system.feature`,行號是場景那一行(第 N 行)。背景三條(「the desktop application is running」「a learning directory with three categories」「"graph/order-security.json" exists」)**每一條都沒有定義**,所以 7 個自動場景都是 undefined。

| 場景(行) | 標籤 | 現況 | 現在守著它的測試 | 差在哪 |
|---|---|---|---|---|
| A person learns a concept today and is asked about it tomorrow(第 12 行) | `@e2e @manual` | 要人做 | 同一件事拆開守著:07 phase-2「Switching also records the current card as learned」+ 06 phase-2 到期卡出現在考試卡 | 要真資料、跨一天;併第 4 節 |
| Teaching order follows the dependency graph(第 22 行) | — | **undefined**(背景 3 + When/Then/And/But 共 7 條) | 07 phase-2「Order comes from the order file」「A missing order file falls back to id order」「Unlearned prerequisites are named」「An unlearned prerequisite does not block」,全綠 | 整合層沒有步驟;行為都守著 |
| Switching category also records the current card as learned(第 29 行) | — | **undefined**(背景 3 + 3 條) | 07 phase-2「Switching also records the current card as learned」,綠 | 同上 |
| Going deeper generates a new level when none exists(第 35 行) | `@llm` | **undefined**(背景 3 + 6 條) | 07 phase-3「Children are generated when there are none」(用假雲端)、「Offline generation falls back and is marked」、「Cancelling writes nothing」,綠 | 同上;**這條有 `@llm`**,真呼叫只能在主簽出、先查 `llm-spend --today`;照 T55 先例,整合層用假雲端(`_fake-cloud.mjs`)即可,真模型留給 golden |
| Going deeper reuses existing children(第 44 行) | — | **undefined**(背景 3 + 3 條) | 07 phase-3「Existing children are reused」,綠 | 同上 |
| Generated cards obey the same body limit(第 50 行) | — | **undefined**(背景 3 + 3 條) | 07 phase-3「Generated cards obey the same word limit」+ 02 的驗證器守門,綠 | 同上 |
| Examples render as markdown with images(第 55 行) | `@manual` | 要人做 | 07 phase-4「Image paths resolve against the assets directory」「A missing image does not break the card」等自動場景;`@manual` 部分 T46–T50 由顧問判過(證據 [T46 驗收](acceptance-T46.md)、[T47 驗收](acceptance-T47.md)、[T48 驗收](acceptance-T48.md)、[T49 驗收](acceptance-T49.md)、[T50 驗收](acceptance-T50.md)) | 整合檔這條是 07 phase-4 的 `@manual` 的重複;**建議顧問判:引用 07p4 證據算數**,不再做第二次 |
| The daily load hint is shown(第 63 行) | `@manual` | 要人做 | **教學卡一側找不到對應的 phase 場景或實作**(考試卡一側有:06 phase-3「估計明天到期幾張」) | 可能是**真缺口**:教學卡頁尾的每日負擔提示;見第 3 節 G3 |
| Categories without raw material follow their configuration(第 69 行) | — | **undefined**(背景 3 + 4 條) | 02 phase-3「A category that allows generation produces from a topic」;07 phase-2「Categories that require raw material are marked」(llm 來源標記),綠 | 同上;兩個 phase 場景各守一半(02 生成、07 標記),整合場景把它們接起來 |
| Desktop review still works as in I3(第 76 行) | `@regression` | **undefined**(背景 3 + 2 條) | `../integration/i3-desktop-review.feature` 全部的自動場景(`@i3`,6 / 6 綠) | 同 I3 盤點的 `@regression` 那條:`@i3` 守著 |

### 背景三條要實作什麼

- 「the desktop application is running」:I3 盤點時已有一條類似的未定義句子(「the desktop application is built for Linux」)。T34 做的 `i3-desktop-review.steps.ts` 已經有「側車起得來、跑在真的 core 上」的做法,I4 可以沿用,不用起真視窗。
- 「a learning directory with three categories」「"graph/order-security.json" exists」:`features/steps/teach-card-phase2.steps.ts` 的背景(「a real learning directory with order files」)已經蓋了差不多的東西,可抽出共用。

## 3. 缺口

- **G1 · 整合層步驟定義(7 條場景)**。工作量跟 T34 的 (A) 相近。**不改任何產品行為。**
- **G2 · 整合工作沒有證據**。roadmap 說「07 接上真的 fs、order 檔、llm-router、scheduler」,實際上做在 T37/T40/T43/T44,但沒有一份文件寫「接上了」。G1 的步驟定義做完就是證據(一個場景從側車動作跑到寫檔與排程狀態),所以併在 G1,不另開票。
- **G3 · 「每日負擔提示」(第 63 行 `@manual`)在教學卡上很可能沒有實作**:場景要求教學卡「頁尾顯示今天學了幾張、明天大約到期幾張」。我查了:「估計明天到期幾張」只存在考試卡一側(06 phase-3、11 phase-1 的場景,以及 T23 工單);對 `apps`、`packages`、`features`、`docs/tickets` 搜「今天學」「learned today」「due tomorrow」「daily load」,**教學卡(`apps/teach-card`)沒有任何命中**,07 phase-2/3/4 也沒有對應場景。這是用搜字找的,沒有逐行讀 `apps/teach-card` 原始碼,**請前端 -84 或顧問確認一次**。若確實沒做,這是 I4 驗收時才會被人眼抓到的缺口,整合工單前要先決定:開 07 的小票補上(需要資料來源:今天學的張數要有地方記;明天到期的估計可用 06 phase-3 同一個函式),還是把這條從 I4 拿掉(改 feature 的範圍,要問使用者)。
- **G4 · `@llm` 場景(第 35 行)**:整合層用假雲端就夠(同 07 phase-3 的作法),不需要在 I4 花真錢。

## 4. 要人做的清單(給顧問判;其中一部分要問使用者)

1. **整合檔的 3 條**:
   - 第 12 行 `@e2e @manual`:今天學一個概念、明天被考。**要真資料與跨一天的時間**(不能用 fixture 假裝時間;能用的話改成「改假時鐘」也只算自動證據,不算這條)。
   - 第 55 行 `@manual`:範例用 markdown 與圖片渲染。**建議引用 07 phase-4 的 `@manual` 證據**。
   - 第 63 行 `@manual`:每日負擔提示。**取決於 G3**。
2. **I2 延到 I4**(ADR-073):`../integration/i2-review-loop-headless.feature` 的 `@e2e`/`@manual`「連用一週」。
3. **I3 延到 I4**:`../integration/i3-desktop-review.feature` 的 `@e2e @manual`「A person completes a review session in the window」,要在真的 `learning/` 上有到期的卡(卡要先被教學卡標成學過,所以必須等 I4 的教學卡接上)。
4. 這些**都需要使用者在自己的機器上、用真的 `learning/`** 做;不能由顧問用 fixture 判過。**建議整合工單合併之後,一次把清單給使用者**(附場景原文與要看什麼),讓使用者決定什麼時候做。

## 5. 建議的下一步(給顧問)

1. 先確認 G3(每日負擔提示有沒有做),這決定整合工單範圍。
2. 開 **1 張整合工單 T66**:補 `i4-two-card-system.feature` 7 條自動場景的步驟定義(沿用 T34 / `i3-desktop-review.steps.ts` 與 `teach-card-phase2/3.steps.ts` 的做法),不改產品行為,不用 `--live`。若 G3 是真缺口,另開一張 07 的小票。
3. T66 合併、`@i4 and not @manual` 全綠、人工清單交使用者之後,I4 才算通過;I2 tag 在這之後補打(ADR-073)。
4. **I4 通過之前**:06 phase-4(縮短版重教)與 I5 不能開工(它們的 gate 是「I4 通過」)。
