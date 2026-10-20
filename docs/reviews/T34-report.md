# T34 實作報告:Wayland 一次性提示接到真前端(B)

日期:2026-10-19。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`3511a5a`(Merge t34-red into t34-start)。實作 commit:`e3e5583`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eacbafa5dffe8NJ8JDrGS2rqwr`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在(`ls .env` → No such file)。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
只做工單 B。A 的測試與步驟定義不碰。沒有跑變異測試(Stryker、cargo-mutants、`npm run mutate`)、完整 cucumber、`npm run check:all`、`tauri dev`、`tauri build`。B4 的 `@manual` 依工單是前端的事,沒跑。不寫 ADR。沒有改測試檔、`.feature`、`contracts/`、`hud.css`、HUD 元件、兩張卡的 `App.svelte`、placeholder 與其 `wayland-note.js`。`window_mode.js` 沒改。沒有新的 Rust 檔,所以 `.cargo/mutants.toml` 的 `examine_globs` 沒加(新函式在已列入的 `window_mode.rs`)。LLM 真呼叫:0。

重活(cargo、vitest 含 headless Chrome、cucumber)等協調者訊息「位子給你」之後才跑,`CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`,同一時間只有一個。位子到的時候實作已經 commit(派工要求位子沒到先寫完並 commit),所以沒有把工作樹倒回去再量一次紅。派工給的參考基底是:Chrome 16 條 12 紅 4 綠;static 21 條 3 紅 18 綠;Rust `wayland_note` 編譯不過。

## 做法

判斷與接線在 `window_mode.rs` 與 `main.rs`,提示程式是新檔 `apps/desktop/src-tauri/src/wayland_note.js`。

- `session_actions(SessionType)` 回 `SessionActions { always_on_top, show_wayland_note }`。X11 置頂、不帶提示;Wayland 不置頂、帶提示。兩者恰好一個。
- `with_wayland_note(script, session)`:Wayland 時在 `init_script` 後面逐字接 `include_str!("wayland_note.js")`;X11 原樣。不在 JSON 多帶一欄,第一行兩個欄位不動。
- `open_windows` 以 `let script = window_mode::with_wayland_note(window_mode::init_script(mode), session)` 交給 `.initialization_script(script.clone())`。session 仍用 `session::detect_from_env()`,偵測規則沒改。
- 拿掉 `build()` 之後對 `__lcShowWaylandNote` 的 `eval`。X11 仍在建立時 `set_always_on_top(true)`,並在 `Focused(true)` 時再置頂一次;這兩次都包在 `session_actions(...).always_on_top` 裡,Wayland 不呼叫。
- 提示等 `DOMContentLoaded`(或 `readyState` 已經不是 loading)才畫。字樣「Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。」,一顆「知道了」。`localStorage` 鍵 `lc-wayland-note-dismissed`、值 `1`,按掉後移除,之後每次載入不再出現。只畫一個。
- 樣式走 CSSOM(`element.style.setProperty`),按鈕用 `data-hud="button"` 與 `.hud-button-label`。顏色只用 `var(--hud-*)`。不用 `style` 屬性、不用 `innerHTML`、不用 `<style>`、不寫死色碼。`position: fixed` 靠底部、`z-index` 在面板之上;盒子 `pointer-events: none`、按鈕 `auto`,所以即使版面重疊,別的按鈕正中心仍點得到。蓋到別的按鈕中心時會往上挪,還蓋到就改成右下角窄條。

## git log

起點 `3511a5a`。

```text
e3e5583 feat(T34): Wayland 一次性提示接到真前端(initialization_script;尚未跑重活測試)
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 20e3ac5..HEAD`(寫本報告前,HEAD 是 `e3e5583`)對 `*.test.ts`、`features/steps`、`features/support`、`*.feature`、`tests`、fixtures 沒有輸出。受保護的 `apps/desktop/src-tauri/tests/wayland_note.rs`、`apps/desktop/src/wayland-note-static.test.ts`、`packages/ui-shared/src/hud/card-render-wayland-note.test.ts` 與兩份 `*-test-support.ts` 沒改。

## git diff --stat

`git diff --stat 3511a5a..e3e5583`(實作 commit,不含本報告):

```text
 apps/desktop/src-tauri/src/main.rs         |  26 ++--
 apps/desktop/src-tauri/src/wayland_note.js | 185 +++++++++++++++++++++++++++++
 apps/desktop/src-tauri/src/window_mode.rs  |  31 +++++
 3 files changed, 227 insertions(+), 15 deletions(-)
```

加上本報告後,`3511a5a..HEAD` 預期 4 檔:上面三個,加 `docs/reviews/T34-report.md`。不應出現 `target/`、`node_modules`。`window_mode.js` 與 `.cargo/mutants.toml` 不在裡。

## git status --porcelain

提交本報告後 `git status --porcelain` 沒有輸出(空)。

## learning/ 量測

只量不改。開工與收工相同。

| | sha256 前 16 | 檔數 | state/log.jsonl 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工 | c2e4dd6d71de3976 | 64 | 108 |

量的是主簽出的 learning/。沒有讀、寫、刪那裡的檔,也沒有碰 raw/、state/ 以外的那次 `wc`。

## 測試

位子到了之後,依派工順序。環境 `CARGO_BUILD_JOBS=2`、`VITEST_MAX_WORKERS=1`。

`CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test wayland_note`

冷編 `Finished test profile ... in 1m 47s`。9 條全過:

```text
running 9 tests
test exactly_one_of_the_two_per_session ... ok
test the_note_script_does_not_depend_on_the_compositor ... ok
test the_note_script_exists_and_is_not_empty ... ok
test the_note_script_follows_the_session_actions ... ok
test the_window_mode_part_is_unchanged_for_wayland ... ok
test wayland_does_not_set_always_on_top_and_shows_the_note ... ok
test wayland_gets_the_window_mode_script_followed_by_the_note_script ... ok
test x11_gets_exactly_the_window_mode_script_and_nothing_about_the_note ... ok
test x11_stays_on_top_and_shows_no_note ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

`Finished test profile ... in 9.51s`。各套件結果原文:

```text
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.52s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.51s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 38 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

合計 249 passed、0 failed(含 lib 4、asset_protocol 19、atomic_write 14、commands 24、event_log 14、learning_fs 28、learning_root 10、logging 4、path_guard 11、review_sidecar 32、review_sidecar_acceptance 4、review_sidecar_stderr 22、start_screen 16、wayland_note 9、window_mode 38;三個 0 passed 是 lc-fs bin、main bin、doc-tests)。

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/hud/card-render-wayland-note.test.ts apps/desktop`

```text
 Test Files  18 passed (18)
      Tests  263 passed (263)
   Start at  17:13:28
   Duration  61.65s (transform 312ms, setup 208ms, import 490ms, tests 59.28s, environment 1ms)
```

`CARGO_BUILD_JOBS=2 NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@integration and @i3 and not @manual' --format summary`

```text
lc-fs rebuilt:     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.15s
6 scenarios (6 passed)
33 steps (33 passed)
0m22.478s (executing steps: 0m21.879s)
```

`npx tsc --noEmit` 退出碼 0。`npm run boundaries`:

```text
boundaries: 掃描 338 個檔案,允許例外 21 條
涵蓋:納管 394 / 掃描 394 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=338
```

`npx tsx scripts/check-doc-links.ts` 與 `npm run lint:docs`(同一支 `scripts/check-doc-links.ts`)。寫完本報告、提交前各跑一次,兩次輸出相同:

```text
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 205 個 markdown 檔,124 條相對連結
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=124
```

## 累計費用

session `ses_eacbafa5dffe8NJ8JDrGS2rqwr`,opencode `session_v2.cost` = **$3.474144**(tokens in 581784、out 9231、reasoning 66233、cache read 3715584)。工單 `budget_usd: 3`,派工寫明 grok 不設上限、只記錄。已略過工單預算,未當停工條件。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。畫面底列若與此有秒差,以協調者畫面上的為準。

## 待協調

無。
