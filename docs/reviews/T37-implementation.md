# T37 實作報告:07-teach-card phase-2

日期:2026-10-21。模型:Grok 4.7。
開工 HEAD:`2cc7d86`(origin/main `4c5aa62` + 紅測試 `6aaf523`)。
實作 commit:`96fe397`。HUD 按鈕接線修正與本報告是接著的 commit。
API key 開工檢查:

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有跑變異測試、`npm run check:all`、沒有建立或使用 `.env`、沒有用 provider 金鑰。LLM 真呼叫:0。沒改測試檔、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`。沒有 `git push`。

## 落點(B-lite)

碰檔案的處理在 `packages/core/src/session/teach.ts`(歸 11)。它 import `teach/` 的純函式(11→07,已開的單向例外)、`session/io` 的 `saveReviewsIfUnchanged`、04 的 `applyLearnedTransition`、01 的 `listCardIds`。讀 order 檔在 `packages/core/src/schema/graph.ts` 的 `readOrderFile`(沒有檔回 `{ kind: 'missing' }`,不是空陣列)。`packages/core/src/teach/deck.ts` 只放純函式(下一張、剩幾張、未學先備、order 與磁碟不一致的排法)。handler 只多四個 case,轉給 `createTeachRuntime`。

視窗:`apps/teach-card/src/teach-session.ts` 注入 `ReviewClient` 與 `LearningFs`。桌面版 `isTauri()` 走 `createReviewClient()` + `createLearningFs()`;單獨執行的 dev server 在 fixture 的暫存複本上起同一支側車(`apps/teach-card/dev/standalone.ts`)。

## must_catch 對到哪段

| must_catch | 程式 |
|---|---|
| 下一個只改記憶體、不寫 reviews | `session/teach.ts` `recordCurrent` 經 `saveReviewsIfUnchanged` 寫磁碟,成功後才 `recordEvent` learned |
| 換類別沒把目前那張標學過 | `switchTo` 先 `recordCurrent`,衝突就不換類別 |
| 重開回到第一個類別 | `teach-session.ts` `localStorage` 鍵 `lc-teach-last-category`,`teach.open` 帶上次的類別;不在設定檔就從第一個開始 |
| 不照 order 檔 | `orderDeck` + `readOrderFile` |
| 沒有 order 檔當成空的、或不記 warning | `kind: 'missing'` 才照 id 排,並寫一筆 `warning`(提到類別、order、ingest);每個類別只記一次 |
| 先備沒學就擋住下一個 | `next` 不看先備,照樣標學過再前進 |
| 跟先備走時把原卡標學過 | `prereq` 只改目前顯示的卡,不寫 |
| 已在 reviews 的卡被重設 | 已在檔裡就直接跳過,不呼叫寫入 |
| 不經 `saveReviewsIfUnchanged` | 唯一寫 reviews 的路就是那個函式 |
| 用 teach.open 讀到的舊內容去寫 | 每次寫入前重讀,用剛讀到的雜湊;衝突重試一次,兩次不過回 `teach-record-changed`,目前卡不前進 |
| 寫完無條件把考試卡基準設成新雜湊 | 只有「寫入前磁碟雜湊 == `session.reviewsHash`」才前進 |
| 考試卡進行中,教學卡標學過後送出報「剛被別的地方改過」 | 基準有前進,submit 看得到新雜湊 |
| 考試卡送出後,教學卡下一次 teach.next 回錯 | 教學卡不留長期基準,每次重讀 |
| 今天跟 session 不是同一個來源 | `today: () => day()`;start 鎖住的那一天,教學卡也用 |
| busy 無限重試 | `REQUEST_TIMEOUT_MS = 180_000`,到了就停,字樣「等候回覆的時間過了。」 |
| learned 沒寫或形狀不對 | reviews 寫成功之後才 `recordEvent({ type: 'learned', card, ts })` |
| 照 webview 給的路徑或任意卡 id 讀寫 | 協定 strictObject 不收 path/card;類別必須在 `categories.yaml`,`index` 必須在未學先備範圍內,否則 `bad-request`,不寫 |
| 桌面版還在讀編進去的 fixture | `App.svelte` 不再 import `stubs/fixture-data` |
| 單獨執行壞掉 | `dev/standalone.ts` + vite plugin,`apply: 'serve'` |
| 既有場景變紅 | 見下面的指令。14 phase-2 掃原始碼要求「下一個」的 `onclick={handleNext}`、`disabled={finished}`,第一輪 cucumber 因此紅了一條,已改回這兩個名字,行為仍走側車 |

## boundaries.allow.json 多的 5 行

對現在的 `origin/main`(`7043e6b`)`git diff origin/main -- scripts/boundaries.allow.json` 是空的,兩邊都是 117 行。我沒有改這個檔。

那 5 行是 `3d471e4`(t37-allow,我用 `git merge --no-ff t37-allow` 合進來,merge commit `6d8fa12`)相對當時的 `4c5aa62` 加上去的,內容就是已經在 origin 上的 **11 → 07** 單向例外,不是新的一條:

```text
  },
  {
    "from": "11-review-cli",
    "to": "07-teach-card",
    "reason": "組合層(ADR-021 例外,同 11 → 04/05):側車 handler 呼叫 07 的純 deck 函式;ADR-077。只開這一條單向,沒有 07 → 11。"
  }
```

07 → 10 是更早的 `4c5aa62`,也已經在 origin。實作 commit `96fe397` 沒有碰 `scripts/boundaries.allow.json`。

## 待協調 → 已解決

`-5c` 的 `t37-red-b-lite`(`32f7fdc`)把 `readOrderFile` 的斷言改量 `schema/graph.ts`,並加 `no-node-static.test.ts`。已 `git merge --no-ff`。`packages/core/src/teach/deck.ts` 已拿掉 `node:fs`、`node:path` 與 `readOrderFile`,只留純函式。生產路徑仍是 `schema/graph.ts` 的 `readOrderFile`。

合進來之後 `npm run boundaries` 紅一條,我沒改測試、也沒改 `scripts/boundaries.allow.json`。違規原文:

```text
✗ 1 個違規 import:
  packages/core/src/teach/no-node-static.test.ts:75  import '../scheduler/transitions.js'  (07-teach-card → 04-scheduler)
```

那一行是測試裡的字串常數(`"import { applyLearnedTransition } from '../scheduler/transitions.js';"`),用來證明掃描器不會把一般套件當成 `node:`。`check-boundaries.ts` 去掉註解之後仍把字串裡的 `from '…'` 當成 import。不是 `deck.ts` 的 import。

## 指令與輸出原文

`npx tsc --noEmit`:無輸出,exit 0。

`npm run boundaries`:

```text
boundaries: 掃描 349 個檔案,允許例外 23 條
涵蓋:納管 405 / 掃描 405 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=349
```

單檔 vitest(`VITEST_MAX_WORKERS=1`),摘錄結尾:

```text
 Test Files  4 passed (4)
      Tests  182 passed (182)
```

(deck、protocol、review-client-teach、teach-session)

```text
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

(t37-handler、t37-conflict)

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

(standalone)

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

(t37-sidecar)

```text
 Test Files  3 passed (3)
      Tests  77 passed (77)
```

(phase2-static、既有 review-client、graph)

```text
 Test Files  5 passed (5)
      Tests  76 passed (76)
```

(protocol-acceptance、review-handler、teach-card lib、既有 review-client)

```text
 Test Files  3 passed (3)
      Tests  287 passed (287)
```

(test-card session、review-handler-acceptance、reviews-optimistic)

```text
 Test Files  3 passed (3)
      Tests  37 passed (37)
```

(session io、answer、test-card no-stubs-static)

cucumber(協調者指定的 tag;另加 `NODE_OPTIONS=--import=tsx`,否則步驟載入不了。第一輪 HUD 接線紅 1,改完再跑):

```text
372 scenarios (90 undefined, 282 passed)
1671 steps (284 undefined, 160 skipped, 1227 passed)
1m11.311s (executing steps: 1m10.115s)
```

exit 1 是因為 90 個 undefined(13-work-dag phase-2 等還沒寫步驟的場景),不是 failed。摘要沒有 failed。07 的五個自動場景不在 Failures 裡。

cargo(cucumber 結束後才跑):

```text
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.03s
```

B-lite 補測試合進來之後(單檔 vitest,`VITEST_MAX_WORKERS=1`):

```text
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

(`packages/core/src/teach/deck.test.ts`、`no-node-static.test.ts`)

`./node_modules/.bin/tsc --noEmit --pretty false --incremental false`:無輸出,`TSC_EXIT:0`。

`npm run boundaries`(合進來之後):

```text
boundaries: 掃描 350 個檔案,允許例外 23 條
涵蓋:納管 406 / 掃描 406 檔(100.0%),未納管目錄:
  (無)

✗ 1 個違規 import:
  packages/core/src/teach/no-node-static.test.ts:75  import '../scheduler/transitions.js'  (07-teach-card → 04-scheduler)

Wave 0 只能 import contracts/ 與自己的目錄。整合後要跨功能,把邊加進 scripts/boundaries.allow.json 並附理由。
gate=boundaries result=FAIL scanned=350
```

learning/ 沒有量、也沒有碰。
