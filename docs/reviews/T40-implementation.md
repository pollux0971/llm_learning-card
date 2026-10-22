# T40 實作報告:兩個視窗共用側車 —— id 由 Rust 編、`busy` 重試只在共用 client

日期:2026-10-22。模型:Grok 4.7(opencode)。
開工 HEAD:`9e0f838`(T40 紅測試已在起點)。
實作 commit:`815bded`。
API key 開工檢查:

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

沒有跑變異測試(`npm run mutate`、cargo-mutants、Stryker)、沒跑 `npm run check:all`、沒有建立或使用 `.env`、沒有用 provider 金鑰。LLM 真呼叫:0。沒改測試檔、`features/steps/**`、`features/support/**`、`.feature`、`contracts/`、`prompts/`、`raw/`、`CLAUDE.md`、`opencode.json`、`REQUEST_TIMEOUT`、`HELLO_TIMEOUT`。沒有 `git push`。沒改 Rust 排隊。

## 做了什麼

落點只在工單列的非測試檔,7 個檔、243 行增、101 行刪。

1. **id 由 Rust 編**(`apps/desktop/src-tauri/src/review_sidecar.rs` 的 `call_locked`)。`Inner.last_id` 換成 `next_wire_id`,從 1 起,只增不減,放在 `Inner` 而不是行程上,所以側車逾時、結束、重起、`shutdown` 都不歸零。信封檢查(`request_line`)沒過就不起側車、也不用掉線上 id。通過之後才把請求的 `id` 換成下一個線上 id 再寫進側車;寫失敗也算用掉,不回退。等回應比的是線上 id(識別碼不同的舊回應照舊丟掉,非協定行照舊丟掉);等到之後只把回應的 `id` 換回 webview 原本的,其餘原樣。`try_lock` 拿不到仍回 `busy`。
2. **`busy` 重試只有一條路**(`apps/desktop/src/webview/review-client.ts`)。匯出 `BUSY_RETRY_MS = 300`、`BUSY_NOTICE_AFTER_MS = 1000`、`BUSY_GIVE_UP_MS = 180_000`(跟 `REQUEST_TIMEOUT` 的 180 秒同一數字,常數沒改)。`createReviewClient` 可注入 `sleep`、`now`。收到 Rust 的 `busy` 就睡 300 ms、用新的 webview id 重送同一個動作與參數;從第一次送出算起**超過** 1 秒才 `onWait(true)` 一次,結束(成功、別的錯誤、放棄)時若通知過就 `onWait(false)` 一次。一直 `busy` 到 180 秒就停,丟 `ReviewError`,`kind` 是 `timeout`、`message` 是 `ERROR_MESSAGES.timeout`、`unsent === true`。其他種類不重試,`unsent` 是 `false`。`ReviewError` 多了 `readonly unsent`。
3. **錯誤只給固定字樣**。同一個檔的 `reviewErrorText`: `ReviewError` 依 `kind` 查 `ERROR_MESSAGES`,不認得的 kind 與不是 `ReviewError` 的錯都回 `internal` 那一句。Rust 的拒絕沒有 `message` 時,`message` 改成查到的句子,不再把 kind 當 message;有 `message` 就原樣。側車 `ok: false` 的 message 仍原樣。
4. **教學卡**(`apps/teach-card/src/teach-session.ts`)拿掉自己的 busy 判斷、`sleep`、`now`、重試常數與迴圈。建 session 時訂 `onWait`: `true` 顯示「考試卡正在批改,稍等一下。」並停用按鈕,`false` 收起;動作結束也收起。錯誤畫面一律 `reviewErrorText`。類別列改成「名稱 · 需要素材 · 剩 N 張」/「學完了」,目前的在最後加「 (目前)」。`categoryNameOf` 用側車回的清單查名稱,查不到回 id。`App.svelte` 標示列用它;清單改成一列一顆、字靠左、「取消」在最下面自己一列;「先備還沒學:」放進自己的 `span`,跟按鈕垂直置中。
5. **考試卡**(`apps/test-card/src/session.ts`、`types.ts`、`App.svelte`)訂 `onWait`。等候時 `waitNotice` 是「複習程式還在準備,稍等一下。」,面板最上面、測試模式那行下面;等候時送出等按鈕停用。`timeout` 且 `unsent` 走「再試一次」(重新 `init`),不走「複習程式停了」。Rust 自己的 `timeout`(`unsent === false`)照舊。`showError` 不認 `busy`。

## must_catch 對到哪段

| must_catch | 程式 |
|---|---|
| 拿掉換號、留著「id 要比上一個大」:兩個 client 交錯會 bad-envelope | `review_sidecar.rs` `call_locked`:拿掉 `id <= last_id` 那段拒絕(原第 257 行)。交錯的 webview id 1、1、2、2、3 都過信封、都成功 |
| 拿掉換號也拿掉舊規則:線上 id 重複或沒一直變大 | 同函式第 264–272 行:`next_wire_id` 從 1 起,寫之前加一,不回退。假側車 `received.log` 看到的是 1、2、3… |
| 換了號沒換回:回應 id 不是 webview 送的 | 同函式第 295–298 行:比到線上 id 之後,把回應的 `id` 設回 `webview_id`。比線上 id 大(2^53−1)與小都換回 |
| 從 1 重新數被舊規則擋住 | 舊的 `last_id` 比較已刪。webview id 不參與拒絕,只用來換回 |
| 側車重起後線上 id 歸 1 或變小 | `next_wire_id` 在 `Inner`(第 191–194、212 行),不在 `Running`。逾時、`sidecar-exited`、`shutdown` 都不寫它 |
| 信封不再要求 id ≥ 1 的整數 | `request_line`(第 63–80 行)沒動。`call_locked` 仍先呼叫它;id 0、字串、小數、缺 id 都是 `bad-envelope`,不起側車、不用掉線上 id |
| 舊回應改比 webview id | 第 295 行比的是 `wire_id`。id 剛好等於 webview id 的舊回應仍丟掉 |
| 考試卡收到 busy 就顯示「複習程式停了」 | `review-client.ts` 第 153–158 行:只有 `busy` 重試,不會把 `busy` 丟給考試卡。`session.ts` 沒有 `busy` 字樣的特別處理 |
| 間隔不是 300 ms、等候不是超過 1 秒、放棄不是 180 秒 | `review-client.ts` 第 10–12、125、137、158 行。門檻是 `>` 1000(剛好 1000 不通知);放棄是 `>=` 180_000,最後一次送出在 179.7 秒、時鐘停在 180 秒 |
| 教學卡留著自己的重試迴圈 | `teach-session.ts` 的 `run`(第 164–174 行)只呼叫 client 一次。沒有 busy 判斷、`sleep`、`now`、重試常數、`setTimeout` |
| 放棄後考試卡顯示「複習程式停了」或只給「重新開始」 | `session.ts` 第 499–501 行:`timeout && unsent` 走 `showRetry`(「等候回覆的時間過了。」加既有的再試一次提示,`canRetry` true、`canRestart` false)。按了就是現在的 `restart()` → `init()`。`unsent === false` 的 timeout 仍落到「複習程式停了」 |
| 教學卡出錯畫面出現英文 kind | `teach-session.ts` 第 171 行 `showError(reviewErrorText(err))`。`reviewErrorText` 在 `review-client.ts` 第 57–59 行,依 kind 查 `ERROR_MESSAGES`,不認得的 kind 與一般 `Error` 都是 internal 那一句 |
| client 把沒有 message 的 Rust 拒絕的 kind 當成 message | `review-client.ts` `rejectionError`(第 62–65 行):沒有字串 `message` 就 `messageOfKind`,不認得的 kind 用 internal;有 `message` 原樣 |
| 類別列字樣順序或「 (目前)」不在最後 | `teach-session.ts` `categoryLabel`(第 62–66 行):「名稱 · 需要素材 · 剩 N 張」或「學完了」;沒有 `require_raw` 是「名稱 · 剩 N 張」;目前的最後加「 (目前)」 |
| 標示列顯示類別 id | `teach-session.ts` `categoryNameOf`(第 184–187 行)查名稱,查不到回 id。`App.svelte` 的 `span.category` 呼叫它,不再直接印 `frontmatter.category` |

O2、O4 沒有列在 must_catch,但修法第 4 節有寫,一起做了:`App.svelte` 的 `.list` 直排、`align-items: flex-start`、標籤字靠左;「先備還沒學:」在 `span.prereq-label`,`align-items: center`。垂直中心差 ≤ 1 px 是 `@manual` 才量,這次沒量。

## 待協調

沒有。紅測試沒改。覺得沒有測錯的地方。

沒跑的(這次位子只核准了 `review_sidecar` 兩個測試檔與那組 cucumber,不是整個 crate):`apps/desktop/src-tauri` 的完整 `cargo test`。Rust 只改了 `review_sidecar.rs` 的 `call_locked` / `Inner`,其他測試不該被這張碰到。要驗收 agent 補跑的話,跟工單「不退步」那列同一條。

## 遇到的問題

- 這個 worktree 沒有 `node_modules`。`package-lock.json` 與主簽出 `/data/python/llm_learning-cards` 相同,所以把那邊的 `node_modules` 做成 symlink,沒跑 `npm ci`、沒打網路。`.gitignore` 的 `node_modules/` 對不上 symlink,`git status` 會看到 `?? node_modules`;沒有 add、沒有 commit。
- CodeGraph 這個 worktree 沒初始化。工單落點是寫死的,沒跑 `codegraph init`。

## 指令與輸出原文

開工金鑰檢查(exit 2,`.env` 不存在是預期的):

```text
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/review-client-busy.test.ts apps/desktop/src/review-client.test.ts apps/desktop/src/review-client-teach.test.ts`:

```text
 Test Files  3 passed (3)
      Tests  50 passed (50)
   Start at  19:49:21
   Duration  677ms (transform 122ms, setup 53ms, import 91ms, tests 242ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/src/teach-session.test.ts apps/teach-card/src/t40-busy.test.ts apps/test-card/src/session.test.ts apps/test-card/src/t40-busy.test.ts`:

```text
 Test Files  4 passed (4)
      Tests  300 passed (300)
   Start at  19:49:25
   Duration  1.01s (transform 219ms, setup 62ms, import 198ms, tests 369ms, environment 0ms)
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/ apps/teach-card/ apps/test-card/`:

```text
 Test Files  33 passed (33)
      Tests  669 passed (669)
   Start at  19:49:30
   Duration  124.29s (transform 579ms, setup 293ms, import 740ms, tests 120.20s, environment 3ms)
```

`npx tsc --noEmit`:無輸出,exit 0。

`npm run boundaries`:

```text
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t40-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t40-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t40-opencode/scripts/gates.config.json
boundaries: 掃描 354 個檔案,允許例外 23 條
涵蓋:納管 410 / 掃描 410 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=354
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 cargo test --test review_sidecar --test review_sidecar_acceptance`(`apps/desktop/src-tauri`):

```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 17.54s
     Running tests/review_sidecar.rs (target/debug/deps/review_sidecar-d3ba8307e625c4a7)

running 41 tests
test a_debug_child_also_gets_the_two_test_variables_but_nothing_else_outside_the_list ... ok
test a_release_child_gets_only_the_allowlist_and_never_the_two_test_variables ... ok
test a_program_that_cannot_start_is_unavailable ... ok
test a_request_over_the_limit_is_refused_and_one_under_it_is_not ... ok
test a_response_line_over_the_limit_becomes_bad_response ... ok
test a_business_error_from_the_sidecar_is_returned_as_is_not_as_a_rust_error ... ok
test a_request_refused_by_the_envelope_check_does_not_use_up_a_wire_id ... ok
test a_business_error_response_also_gets_the_webview_id_back ... ok
test an_invalid_envelope_is_refused_before_anything_starts ... ok
test a_client_that_starts_counting_from_one_again_after_larger_ids_still_succeeds ... ok
test neither_build_passes_node_options_keys_llm_or_anything_unlisted ... ok
test parse_response_line_judges_every_response_vector_the_way_the_file_says ... ok
test parse_response_line_refuses_a_line_over_the_limit ... ok
test request_line_judges_every_request_vector_the_way_the_file_says ... ok
test rust_never_looks_at_the_method_name_or_the_result_or_error_content ... ok
test a_sidecar_that_exits_is_reported_and_the_next_call_starts_a_new_one ... ok
test a_stale_response_is_matched_on_the_wire_id_even_when_it_carries_the_webview_id ... ok
test shutdown_without_a_sidecar_does_nothing ... ok
test lines_that_are_not_protocol_lines_are_dropped_and_never_returned ... ok
test the_constants_are_fixed ... ok
test the_envelope_check_is_by_type_not_by_looking_inside_params_or_method ... ok
test a_stale_response_with_another_id_is_dropped_and_the_right_one_is_returned ... ok
test the_envelope_check_still_requires_a_positive_integer_id_and_refuses_before_anything_starts ... ok
test the_child_environment_is_exactly_what_the_spec_says ... ok
test a_sidecar_that_never_says_hello_is_unavailable_and_not_left_running ... ok
test the_sidecar_command_is_node_with_tsx_and_the_two_paths ... ok
test shutdown_kills_a_sidecar_that_ignores_eof_after_the_grace_period ... ok
test shutdown_closes_stdin_and_waits_for_a_sidecar_that_exits_on_eof ... ok
test the_vector_file_is_the_one_ts_reads ... ok
test the_request_is_written_as_request_line_says_and_the_response_comes_back_untouched ... ok
test the_response_id_is_the_one_the_webview_sent_larger_and_smaller_than_the_wire_id ... ok
test the_same_webview_id_twice_in_a_row_is_fine_each_gets_its_own_wire_id ... ok
test variables_that_are_not_set_are_not_invented ... ok
test when_the_app_is_not_configured_nothing_starts_and_the_error_says_so ... ok
test a_request_that_gets_no_answer_times_out_kills_the_sidecar_and_the_next_call_starts_a_new_one ... ok
test the_sidecar_starts_on_the_first_call_not_before_and_is_reused ... ok
test a_second_call_while_one_is_waiting_gets_busy_and_the_first_still_finishes ... ok
test the_timed_out_sidecar_is_really_gone_not_a_zombie ... ok
test two_clients_that_both_count_from_one_can_interleave_and_the_wire_ids_keep_growing ... ok
test the_wire_id_does_not_reset_when_the_sidecar_exited ... ok
test the_wire_id_does_not_reset_when_the_sidecar_is_restarted_after_a_timeout ... ok

test result: ok. 41 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.74s

     Running tests/review_sidecar_acceptance.rs (target/debug/deps/review_sidecar_acceptance-c040b5e7af7fd5e9)

running 4 tests
test closing_the_app_shuts_the_sidecar_down_from_the_exit_event ... ok
test a_response_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused ... ok
test a_request_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused ... ok
test a_protocol_looking_line_that_is_not_hello_does_not_count_as_hello ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s
```

`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 NODE_OPTIONS=--import=tsx npx cucumber-js --tags "((@teach-card and @phase-2 and not @manual) or (@i2 and not @manual) or (@i3 and not @manual) or (@phase-1 and not @manual))" --format summary`:

```text
lc-fs rebuilt:     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.15s
front ends built: 25:     data-hud-edge={edge}
498 scenarios (498 passed)
2278 steps (2278 passed)
2m21.498s (executing steps: 2m20.051s)
```

summary 沒有印 undefined;2278 steps 全部 passed,沒有 undefined。
