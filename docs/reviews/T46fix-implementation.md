# T46fix 實作報告

日期:2026-10-24。模型:Grok 4.7(opencode)。分支:`pollux0971/t46fix-opencode`。
開工 HEAD:`611df00`(t46fix-start:實作 b447a2d + 追加紅測試)。

## 第一步金鑰檢查

```
$ [ -n "$OPENAI_API_KEY" ] && echo SET || echo UNSET; [ -n "$ANTHROPIC_API_KEY" ] && echo SET || echo UNSET; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。沒跑變異測試、沒跑整條 `check:all`、沒有 `git push`。沒改測試檔、`features/**`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`。

## 做了什麼

只改 `packages/ui-shared/src/example-fence.ts`。

`node_modules` 這個 worktree 原本沒有。用 tar 從 `/data/python/llm_learning-cards` 複製(不 symlink;排除巢狀 `node_modules`、`.vite`、`.vite-temp`)。複製後 `node_modules/@learning/ui-shared` 是相對連結 `../../packages/ui-shared`,realpath 指到這個 worktree 的 `packages/ui-shared`。`node_modules/` 在 `.gitignore`,沒有 add。

## 修法與理由

缺陷:抓原文路徑時只記「這輪 image 規則裡第一次」`normalizeLink` 的引數。markdown-it 掃 alt 兩次,而且都在能碰到別的網址的地方呼叫 `normalizeLink`:

- `parseLinkLabel` → `skipToken`,在這顆圖自己的目的地正規化**之前**(alt 裡的連結、autolink、linkify)。
- 目的地正規化之後,`inline.parse` 再掃一次 alt。

所以 `![see [l](http://x.test/l)](../../assets/c.png)` 第一次抓到的是連結網址,不是圖的路徑。連結目標若長得像圖片路徑,外層圖會拿那個路徑去要檔案。

只挑「第一個」或「最後一個」不夠:連結可能在目的地之前,也可能在之後;正規化後還可能跟圖的 `src` 撞成同一串,first/last 都會拿錯。

採用的修法(兩個一起,不是內容特例):

1. 掃 alt 的那兩段(`helpers.parseLinkLabel`、`inline.parse`)先把擷取關掉。巢狀圖會再進 image 規則,自己開一輪清單,外層已抓到的不會被清掉。
2. 關掉之後記下來的引數,只留 `normalizeLink(引數) === token.attrGet('src')` 的那個。這顆 token 的 `src` 就是 markdown-it 拿這顆圖自己的目的地呼叫 `normalizeLink` 的回傳值,對得上的引數才是這顆圖的原文路徑。

參考式圖片(`![alt][ref]`)的 `normalizeLink` 發生在定義 reference 時,不在 image 規則裡。這次沒有這類測試,行為與修之前一樣(沒有 `rawSrc` 就走原本的 image 渲染)。不在這張的紅測試範圍。

## 跑過的指令與輸出原文

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/image-path.test.ts`:

```
 Test Files  1 passed (1)
      Tests  139 passed (139)
   Start at  10:53:51
   Duration  327ms (transform 96ms, setup 40ms, import 48ms, tests 138ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src --exclude '**/card-render*.test.ts' --exclude '**/render.test.ts' --exclude '**/render-accept.test.ts' --exclude '**/gallery-phase2.test.ts' --exclude '**/window-frame.test.ts'`:

```
 Test Files  16 passed (16)
      Tests  376 passed (376)
   Start at  10:54:32
   Duration  4.04s (transform 227ms, setup 160ms, import 302ms, tests 2.07s, environment 1ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card --exclude '**/*render*.test.ts'`:

```
 Test Files  12 passed (12)
      Tests  129 passed (129)
   Start at  10:54:52
   Duration  18.59s (transform 279ms, setup 131ms, import 322ms, tests 17.00s, environment 1ms)
```

渲染測試一次一個檔,每個都是 `CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run <檔>`。依序:

- `packages/ui-shared/src/hud/card-render.test.ts` — 18 passed,Duration 39.78s
- `packages/ui-shared/src/hud/card-render-phase3.test.ts` — 8 passed,Duration 20.17s
- `packages/ui-shared/src/hud/card-render-t32.test.ts` — 6 passed,Duration 13.71s
- `packages/ui-shared/src/hud/card-render-wayland-note.test.ts` — 16 passed,Duration 39.88s
- `packages/ui-shared/src/hud/card-render-wayland-note-t35.test.ts` — 21 passed,Duration 45.03s
- `packages/ui-shared/src/hud/render.test.ts` — 10 passed,Duration 4.60s
- `packages/ui-shared/src/hud/render-accept.test.ts` — 2 passed,Duration 2.46s
- `packages/ui-shared/src/hud/gallery-phase2.test.ts` — 13 passed,Duration 6.24s
- `packages/ui-shared/src/hud/window-frame.test.ts` — 12 passed,Duration 23.39s
- `apps/teach-card/src/t44-generating-render.test.ts` — 11 passed,Duration 17.83s
- `apps/teach-card/src/t45-status-layout-render.test.ts` — 42 passed,Duration 65.56s
- `apps/teach-card/src/t46-examples-images-render.test.ts` — 23 passed,Duration 39.90s

每一檔的 vitest 摘要都是 `Test Files  1 passed (1)`。

`npx tsc --noEmit`:沒有輸出,exit 0。

## 待協調

無。紅測試看起來是在量工單第 3 節(每一張圖都算、原文路徑是這顆圖自己的),沒有改測試。
