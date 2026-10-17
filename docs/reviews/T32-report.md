# T32 實作報告:考試卡 header 的「已答 / 總數」與「逾期 N」放同一行

日期:2026-10-18。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`8da755a`(chore: origin/main 59f220b + 紅測試 t32-red 7476c55)。實作 commit:`4fefb49`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb4566856ffeqejfx3Pk5GhoG6`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試、cucumber、`npm run check:all`、`tauri dev`、`tauri build`。工單「怎麼跑」列了 cucumber;派工寫明不跑,以派工為準。`@manual` 依工單是前端的事,沒跑。重活(vitest 含 headless Chrome)用協調者派工時給的位子,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,同一時間只有一個。LLM 真呼叫:0。不寫 ADR。沒有改測試檔、`.feature`、`packages/ui-shared`、Rust、contracts。

## 做法

只動 `apps/test-card/src/App.svelte` 的 `<style>`。DOM、文字、class、HpBar 的位置都沒動。

header 有三個子元素(兩段字 + HP 條)。`.progress` 從一欄 grid 改成 flex 換行:兩段靠左同一行,`column-gap: 0.75rem`(12 px,落在 8–24),`row-gap: 0.2rem`(HP 條跟上面那一行維持原本 3.2 px)。HP 條自己佔一行用 `:global([data-hud='hp-bar'])` 加 `flex-basis: 100%`,選擇器有 `:global`,Svelte 才不會把規則丟掉。這條規則只有 `flex-basis`,沒有 border 之類 T15 `styleProblems` 會擋的東西。

## git log

起點 `8da755a`。

```text
4fefb49 feat(T32): 考試卡 header 兩段同一行,HP 條自己一行全寬
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 8da755a..4fefb49` 對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、fixtures 沒有輸出。受保護的 `packages/ui-shared/src/hud/card-render-t32.test.ts` 與 `packages/ui-shared/src/hud/card-design-values-test-support.ts` 沒改。

## git diff --stat

`git diff --stat 8da755a..4fefb49`(實作 commit,不含本報告):

```text
 apps/test-card/src/App.svelte | 9 +++++++--
 1 file changed, 7 insertions(+), 2 deletions(-)
```

加上本報告後,`8da755a..HEAD` 預期 2 檔:上面那個,加 `docs/reviews/T32-report.md`。

## git status --porcelain

提交本報告後 `git status --porcelain` 沒有輸出(空)。

## App.svelte 的 style diff

改動全部在 `<style>` … `</style>`(apps/test-card/src/App.svelte 第 212–220 行)。`<style>` 以外沒有 diff。

```text
   .progress {
-    display: grid;
-    gap: 0.2rem;
+    display: flex;
+    flex-wrap: wrap;
+    column-gap: 0.75rem;
+    row-gap: 0.2rem;
+  }
+  .progress > :global([data-hud='hp-bar']) {
+    flex-basis: 100%;
   }
```

## learning/ 量測

只量不改。開工與收工相同。

| | sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工 | c2e4dd6d71de3976 | 64 | 108 |

量的是主簽出的 learning/。沒有讀、寫、刪那裡的檔,也沒有碰 raw/、state/ 以外的那次 `wc`。

## 測試

實作前,`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-render-t32.test.ts`:

```text
 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
   Start at  04:59:42
   Duration  15.69s (transform 100ms, setup 40ms, import 103ms, tests 15.45s, environment 0ms)
```

與派工參考基底一致(6 條、3 紅 3 綠)。紅的三條:

- 驗收 1 同一行:兩段上緣 y「0 / 3」45.0、「逾期 0」72.2,差 27.1875(預期 ≤ 1)。
- 驗收 1 間距:「逾期 N」左緣 16.2 減「已答 / 總數」右緣 343.8 = -327.625(預期 ≥ 8)。
- 答一題之後:兩段不在同一行,差 27.1875。

實作後,同一條:

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  05:01:11
   Duration  15.11s (transform 101ms, setup 40ms, import 102ms, tests 14.88s, environment 0ms)
```

派工指定的範圍(`card-render-t32.test.ts`、`card-render.test.ts`、`card-render-phase3.test.ts`、`apps/test-card`、`packages/ui-shared/src/hud`;card-static 系列在 hud 底下,含 T15、T23 的考試卡渲染與靜態測試):

```text
 Test Files  25 passed (25)
      Tests  575 passed (575)
   Start at  05:01:33
   Duration  136.45s (transform 393ms, setup 263ms, import 653ms, tests 133.29s, environment 2ms)
```

## svelte 編譯

`svelte/compiler` 的 `compile`(`generate: client`)對改前 HEAD 與改後各編一次。兩邊都是 1 條既有 warning:`state_referenced_locally`(apps/test-card/src/App.svelte 第 13 行,script 裡的 `deps`,不在 `<style>`)。沒有新 warning,沒有 `css_unused_selector` / Unused CSS selector。

## 收工檢查

`npx tsc --noEmit`:exit 0。

`npm run boundaries`:

```text
boundaries: 掃描 336 個檔案,允許例外 21 條
涵蓋:納管 392 / 掃描 392 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=336
```

`npx tsx scripts/check-doc-links.ts` 與 `npm run lint:docs`(同一支 `scripts/check-doc-links.ts`)。寫本報告前是 198 個 markdown 檔、99 條相對連結、PASS。寫完本報告、提交前再各跑一次,兩次輸出相同:

```text
doc-links: 掃描 199 個 markdown 檔,99 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=99
```

## 累計費用

session `ses_eb4566856ffeqejfx3Pk5GhoG6`,opencode `session_v2.cost` = **$0.712944**(tokens in 140933、out 5329、reasoning 12512、cache read 648064)。工單 `budget_usd: 1`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。畫面底列若與此有秒差,以協調者畫面上的為準。

## 待協調

無。
