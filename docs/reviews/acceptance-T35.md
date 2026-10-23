# 驗收 T35:Wayland 提示讓出位置

- 被驗:分支 t35-impl,sha 76c1d3f7477cdb39fac1937c0af17fa23474482d,tree 41910104681f72912ad0beb3564635ef54934fc8(開跑與跑完相同)
- 基底 t35-start 9a0c8f3(main ce3817a + 紅測試 6191360)。日期 2026-10-23。驗收:-5b。
- 簽出:乾淨 worktree,無 .env(ls 失敗),VITEST_MAX_WORKERS=1。
- 重編:本張只改一支 JS,沒有 Rust 產物要重編。

## 測試作者
實作 commit 只有 44360f6、76c1d3f,只動 wayland_note.js 與 docs/reviews/T35-implementation.md。
受保護測試檔(card-render-wayland-note-t35.test.ts、card-render-test-support.ts、render-test-support.ts)在 9a0c8f3 之前就在,實作 commit 0 變動。

## 基準(未突變)
- T35 新測試 + T34 提示測試兩檔:33 條全過。
- 加跑 render-test-support.test 與 apps/desktop 全部:347 過、1 條 learning-root-probe 逾時(5 秒,整批單 worker 跑 300 秒時);該檔單獨重跑 10 條全過。與本張無關,算負載型逾時。
- tsc --noEmit:乾淨。boundaries:PASS scanned=355。

## 自選突變(都只改 wayland_note.js,改完還原,git status 乾淨)
指令:VITEST_MAX_WORKERS=1 npx vitest run 兩個 wayland-note 測試檔。

| 編號 | 改了什麼 | 結果 | 紅的測試 |
|---|---|---|---|
| A1 | 拿掉設 padding-bottom 那行(must_catch 1) | 紅 8 條 | 留白、捲到底不蓋、變窄重算 |
| A2 | stop() 不 release(must_catch 4) | 紅 4 條 | 按「知道了」、按掉之後才換畫面 |
| A3 | 留白只算第一次(must_catch 3) | 紅 2 條 | 變窄重算 |
| N7 | 捲動區選擇器改成 body(must_catch 5 的「別的元素」) | 紅 8 條 | 留白、捲到底不蓋、變窄重算 |
| N1 | 原本的 padding 當 0 | 紅 4 條 | 留白、變窄重算 |
| N2 | 留白多 1 px | 紅 4 條 | 留白、變窄重算 |
| N3 | pin 的 bottom 改 12px | 紅 4 條 | 固定在底部不動、變窄重算 |
| N4 | pin 的 left 改 0px | 紅 2 條 | 固定在底部不動 |
| N6 | dismissed() 永遠 false | 紅 4 條 | T34 B2 兩條 |
| N8 | 按鈕 pointer-events 改 none | 紅 2 條 | T34 B5 |
| N9 | 拿掉 ResizeObserver 的 observe | 紅 2 條 | 變窄重算 |
| N5 | 拿掉「捲動區換了就重記原本值」判斷 | **存活** | 沒有測試把 .hud-body 換掉,低風險缺口 |
| N10 | release 一律 removeProperty,不還原原本 inline 值 | **存活** | 測試的 .hud-body 原本沒有 inline padding-bottom,所以分不出來。工單做法建議第二點要還原;目前不會出事 |
| N11 | pin 把 position 改 absolute | **存活** | show() 先設 fixed、pin 再覆蓋;body 不捲,畫面矩形一樣。實務上近似等價,但「fixed」沒被釘 |

must_catch 第 2(把 T34 擺位加回)與第 6(T34 不退步)由 N3/N4/N6/N8 加 T34 檔全綠間接證明;-a6 自己的 8 個改壞證明沒重做。

## 變異測試
工單沒有指定 Stryker 範圍給這支 JS,沒跑。以上為手改突變:14 個,11 紅、3 存活。

## 對抗式審核
沒做(單檔小改,手改突變已涵蓋)。

## learning/ 前後
前:64 檔 / c2e4dd6d71de3976 / 108 行。後:64 檔 / c2e4dd6d71de3976 / 108 行。相同。

## 花費
實際 $1.62(協調者給的數字),預算 2,比值 0.81,未超 2 倍。

## 結論
通過,附三個存活缺口(N5、N10、N11),都低風險,不擋;要補的話由測試 agent 寫。
