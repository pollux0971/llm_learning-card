# T28 實作報告:側車 stderr 轉到 app 時,前綴只印一次

日期:2026-10-17。模型:Grok 4.7(xai/grok-4.7)。
開工 HEAD:`5a02fb4`(t28-start: main 9af3c3b + t28-red 0a89e8b)。實作 commit:`6194544`。
本報告是接著的 commit(提交時還不在下面的 log 裡;提交後 porcelain 空)。
session id:`ses_eb68c341dffec9vedTiRK6i3Yt`。
API key:`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`XAI_API_KEY` 都是 `UNSET`。`.env` 不存在。`opencode.json` 的 `permission.skill` 是 `{"*":"deny"}`。開工 `git status --porcelain` 空。
沒有跑變異測試(cargo-mutants、Stryker、`npm run mutate`)、`tauri build`、cucumber。`@manual` 依工單是前端的事,沒跑。重活只用協調者派工時給的位子,`CARGO_BUILD_JOBS=2`,只編/跑三個測試檔。

## 做法

落點只有 `apps/desktop/src-tauri/src/review_sidecar.rs`。

- `STDERR_PREFIX` 是 `[review-sidecar] `(結尾一個空白)。
- `host_stderr_line` 先去掉結尾所有的 `\n` 與 `\r`(中間的 `\r` 留著),再用 `String::from_utf8_lossy`。已是該前綴開頭(逐位元組、分大小寫、不先去空白)就原樣回傳,否則前面加一次。
- `forward_lines` 用 `read_until` 讀到 EOF 或讀錯才停。每一行換成上面的字串、補一個 `\n`,一次 `write_all` 寫進 sink。寫失敗不 panic,繼續讀到 EOF,之後的行不再試寫。
- `forward_stderr` 只剩接線:執行緒裡跑 `forward_lines(BufReader::new(stderr), std::io::stderr())`。`spawn` 裡呼叫它的地方沒動。
- Rust 自己印的兩行 `dropped non-protocol line` 照舊,不經過 `host_stderr_line`。
- 沒改 `scripts/review-sidecar.ts`,沒寫 ADR。

這個檔原本不過 rustfmt(同目錄多數 `.rs` 也沒過)。派工要求改過的檔 `cargo fmt --check` 要乾淨,所以對這一個檔跑了 rustfmt。換行是格式,行為沒變。其他檔被 `cargo fmt` 掃到的都已還原,沒有進 commit。

## git log

起點 `5a02fb4`。

```text
6194544 fix(T28): 側車 stderr 轉到 app 時前綴只印一次
```

不屬於測試作者 commit 的測試檔變動:空。`git diff --name-only 5a02fb4..HEAD` 對 `*.test.ts`、`apps/desktop/src-tauri/tests`、`features/steps`、`features/support`、`*.feature` 沒有輸出。沒有改那些檔,也沒有改 `.feature`、`contracts/`、帶 SOURCE 標頭的模板、`packages/core/prompts/`。

## git diff --stat

`git diff --stat 5a02fb4..6194544`(實作 commit,不含本報告):

```text
 apps/desktop/src-tauri/src/review_sidecar.rs | 170 +++++++++++++++++++++------
 1 file changed, 134 insertions(+), 36 deletions(-)
```

加上本報告後,`5a02fb4..HEAD` 預期兩檔:`review_sidecar.rs` 與 `docs/reviews/T28-report.md`。

## git status --porcelain

提交本報告後 `git status --porcelain` 沒有輸出(空)。

## 開工紅

```bash
CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test review_sidecar_stderr
```

編不過,E0432(還沒有那三個匯出)。原文:

```text
error[E0432]: unresolved imports `learning_cards_desktop::review_sidecar::forward_lines`, `learning_cards_desktop::review_sidecar::host_stderr_line`, `learning_cards_desktop::review_sidecar::STDERR_PREFIX`
  --> tests/review_sidecar_stderr.rs:32:5
   |
32 |     forward_lines, host_stderr_line, SidecarHost, SidecarSpec, SidecarTimeouts, STDERR_PREFIX,
   |     ^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^ no `host_stderr_line` in `review_sidecar`   ^^^^^^^^^^^^^ no `STDERR_PREFIX` in `review_sidecar`
   |     |
   |     no `forward_lines` in `review_sidecar`

For more information about this error, try `rustc --explain E0432`.
error: could not compile `learning-cards-desktop` (test "review_sidecar_stderr") due to 1 previous error
warning: build failed, waiting for other jobs to finish...
```

退出碼 101。

## 轉綠

```bash
CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test review_sidecar_stderr --test review_sidecar --test review_sidecar_acceptance
```

三個測試檔的 Test result 原文:

```text
     Running tests/review_sidecar.rs (apps/desktop/src-tauri/target/debug/deps/review_sidecar-d3ba8307e625c4a7)

running 32 tests
test a_debug_child_also_gets_the_two_test_variables_but_nothing_else_outside_the_list ... ok
test a_release_child_gets_only_the_allowlist_and_never_the_two_test_variables ... ok
test a_program_that_cannot_start_is_unavailable ... ok
test a_request_over_the_limit_is_refused_and_one_under_it_is_not ... ok
test an_invalid_envelope_is_refused_before_anything_starts ... ok
test a_stale_response_with_another_id_is_dropped_and_the_right_one_is_returned ... ok
test neither_build_passes_node_options_keys_llm_or_anything_unlisted ... ok
test parse_response_line_judges_every_response_vector_the_way_the_file_says ... ok
test parse_response_line_refuses_a_line_over_the_limit ... ok
test lines_that_are_not_protocol_lines_are_dropped_and_never_returned ... ok
test request_line_judges_every_request_vector_the_way_the_file_says ... ok
test rust_never_looks_at_the_method_name_or_the_result_or_error_content ... ok
test a_response_line_over_the_limit_becomes_bad_response ... ok
test shutdown_kills_a_sidecar_that_ignores_eof_after_the_grace_period ... ok
test shutdown_without_a_sidecar_does_nothing ... ok
test a_business_error_from_the_sidecar_is_returned_as_is_not_as_a_rust_error ... ok
test the_constants_are_fixed ... ok
test the_envelope_check_is_by_type_not_by_looking_inside_params_or_method ... ok
test a_sidecar_that_exits_is_reported_and_the_next_call_starts_a_new_one ... ok
test the_sidecar_command_is_node_with_tsx_and_the_two_paths ... ok
test the_child_environment_is_exactly_what_the_spec_says ... ok
test request_ids_must_increase_and_a_refused_one_is_not_sent ... ok
test the_vector_file_is_the_one_ts_reads ... ok
test variables_that_are_not_set_are_not_invented ... ok
test when_the_app_is_not_configured_nothing_starts_and_the_error_says_so ... ok
test shutdown_closes_stdin_and_waits_for_a_sidecar_that_exits_on_eof ... ok
test a_sidecar_that_never_says_hello_is_unavailable_and_not_left_running ... ok
test the_request_is_written_as_request_line_says_and_the_response_comes_back_untouched ... ok
test the_sidecar_starts_on_the_first_call_not_before_and_is_reused ... ok
test a_request_that_gets_no_answer_times_out_kills_the_sidecar_and_the_next_call_starts_a_new_one ... ok
test the_timed_out_sidecar_is_really_gone_not_a_zombie ... ok
test a_second_call_while_one_is_waiting_gets_busy_and_the_first_still_finishes ... ok

test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.03s


running 4 tests
test closing_the_app_shuts_the_sidecar_down_from_the_exit_event ... ok
test a_response_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused ... ok
     Running tests/review_sidecar_acceptance.rs (apps/desktop/src-tauri/target/debug/deps/review_sidecar_acceptance-c040b5e7af7fd5e9)
test a_request_line_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused ... ok
test a_protocol_looking_line_that_is_not_hello_does_not_count_as_hello ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.50s

     Running tests/review_sidecar_stderr.rs (apps/desktop/src-tauri/target/debug/deps/review_sidecar_stderr-94479b5a34f368b8)

running 22 tests
test a_real_read_error_ends_the_loop_and_returns_the_lines_so_far ... ok
test a_line_is_one_line_even_when_the_reader_hands_it_over_in_tiny_pieces ... ok
test a_last_line_without_a_trailing_newline_is_still_written_with_one ... ok
test a_sink_that_accepts_only_a_few_bytes_per_write_still_gets_every_byte ... ok
test a_sink_that_always_fails_does_not_panic_and_the_reader_is_still_read_to_eof ... ok
test a_sink_that_fails_only_after_the_first_line_still_lets_the_rest_be_read ... ok
test already_prefixed_lines_come_out_unchanged_and_exactly_one_prefix ... ok
test an_interrupted_read_is_retried_not_treated_as_the_end ... ok
test empty_input_returns_zero_and_writes_nothing ... ok
test empty_lines_are_forwarded_as_prefix_only_lines ... ok
test host_stderr_line_follows_the_ticket_table_row_by_row ... ok
test invalid_utf8_does_not_stop_the_forwarding_the_next_lines_still_come_out ... ok
test newlines_are_removed_before_the_prefix_check ... ok
test forward_stderr_is_only_wiring_a_thread_running_forward_lines_on_the_real_stderr ... ok
test three_input_lines_make_exactly_three_writes_each_one_converted_line_plus_newline ... ok
test the_two_rust_own_dropped_line_messages_are_untouched ... ok
test forward_lines_uses_read_until_and_one_write_all_and_never_eprintln_unwrap_or_expect ... ok
test invalid_utf8_becomes_the_replacement_character_per_bad_byte_and_does_not_panic ... ok
test the_prefix_constant_is_fixed_with_one_trailing_space ... ok
test the_prefix_check_is_byte_exact_starts_with_not_contains_or_trimmed_or_case_folded ... ok
test trailing_newlines_and_carriage_returns_are_all_removed_but_inner_ones_stay ... ok
test what_the_sidecar_prints_reaches_the_app_stderr_with_exactly_one_prefix_per_line ... ok

test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
```

其他收工檢查:

- `npx tsc --noEmit` 退出碼 0,沒有輸出(0 錯)
- `npm run boundaries` PASS(掃描 326,允許例外 21)
- `npx tsx scripts/check-doc-links.ts` 綠(掃描 185 個 markdown,53 條相對連結)
- `npm run lint:docs` 綠(同一支 `check-doc-links.ts`)
- `rustfmt --edition 2021 --check apps/desktop/src-tauri/src/review_sidecar.rs` 退出碼 0
- 工單「怎麼跑」的 vitest:`VITEST_MAX_WORKERS=1 npx vitest run scripts/review-sidecar.test.ts apps/desktop/src/review-sidecar-static.test.ts` — 2 files,27 tests passed

## learning/ 前後量測

只量不改。量法:在 `/data/python/llm_learning-cards/learning` 做雜湊前 16 碼、檔案數、`state/log.jsonl` 行數。沒有讀寫 `learning/`、`raw/`、`state/` 的內容。

| 時點 | 雜湊前 16 碼 | 檔案數 | log 行數 |
|---|---|---|---|
| 開工 | c2e4dd6d71de3976 | 64 | 108 |
| 收工(報告 commit 前) | c2e4dd6d71de3976 | 64 | 108 |
| 收工(報告 commit 後再量一次) | c2e4dd6d71de3976 | 64 | 108 |

前後相同。

## 累計費用

session `ses_eb68c341dffec9vedTiRK6i3Yt`,opencode `session_v2.cost` = **$1.842414**(tokens in 196483、out 9392、reasoning 31116、cache read 2412800)。工單 `budget_usd: 1`,派工寫明 grok 不設上限、只記錄。LLM 真呼叫:0(三把 key 都 UNSET)。數字是提交報告前的快照,不含提交報告這一步之後的 token。

## 待協調

無。
