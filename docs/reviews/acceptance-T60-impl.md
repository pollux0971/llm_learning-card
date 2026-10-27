# T60 實作驗收證據:測試封閉性(只改測試)

- 工單:T60(`docs/tickets/T60-test-hermetic-home-tmp.md`)
- 被驗分支:`t60-impl` tip `8d5994e84dc7a6b116c2376b5dc1cdec55f403f2`(基底 `d71c670`;兩個 commit:`aaa93e4`、`8d5994e`)
- 開跑與跑完的 tree sha(筆電與 i9 兩邊一樣):`2be6ee05850b0b9e2c411dbb8c8ff5e577a09213`
- 日期:2026-10-27
- 乾淨簽出:筆電與 i9 都是 `git worktree add --detach`;兩邊 `ls .env` 都是 No such file;i9 `npm ci`
- 重編:這張只改測試,不重編。空 HOME 全套 cucumber 時 `lc-fs` 由 cucumber 的 BeforeAll 自己重編(輸出有 `Finished`)。

## 1. 基準與測試作者

- 改到的檔:`scripts/review.test.ts`、`scripts/review-router.test.ts`、`scripts/check-gates-pinned.test.ts`、`scripts/degraded-report.test.ts`,四個,+45/-7。`run-tests.test.ts` 沒改。
- 兩個 commit 作者都是同一個測試 agent 帳號(測試只由測試 agent 改):通過。
- 不動的地方(`packages apps contracts prompts features/**/*.feature scripts/review.ts degraded-report.ts run-tests.ts check-gates-pinned.sh vitest.config.ts`)diff:0 行。
- 變異輸出目錄進歷史的檔數:0。

## 2. 斷言沒放鬆(第 2 點)

- 被刪掉的行共 7 行:`import { …afterEach }`(補上 `beforeAll, afterAll`)、`const TEMP_BASE = '/tmp/opencode'`、三行 `spawnSync(…)`(只加 `env:`)、`review-router` 的 `env:` 一行、`review.test` 的 `env:` 一行。**沒有任何以 `expect(` 開頭的行被刪。**
- `expect(` 出現次數(基底 → 分支):review 42 → 42、review-router 32 → 32、check-gates-pinned 58 → 58、degraded-report 212 → 212。
- 期望字樣 `Nothing is due`、`張未排程`、`Test Files\s+1 passed` 都還在、一個字沒動。

## 3. 工單 must_catch(i9;空 HOME;`env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME -u NO_COLOR -u FORCE_COLOR HOME=<新開空目錄>`)

| # | 做法 | 基底(`d71c670`) | 修後(`8d5994e`) |
|---|---|---|---|
| 1 | review.test 不帶 dry-run 那條讀真的指標檔 | **紅 1/20**:`FAIL scripts/review.test.ts > review.ts --dry-run:0 張卡不是空閒日 > 基數那一行只屬於 --dry-run:不帶旗標的實際複習不可以印它`;`AssertionError: expected '指標檔不存在:…/.config/llm-learning-cards/vault.json…' to contain 'Nothing is due today.'` | 綠 |
| 2 | review/review-router 子行程把快取寫進 HOME | 三個檔跑完 HOME 多 `.cache/llm-learning-cards/<uuid>`(1 個資料夾) | 三個檔 42/42 綠;HOME 只剩 `.npm` |
| 3 | check-gates-pinned 寫死 `/tmp/opencode` | 用監看迴圈每 0.05 秒數:`/tmp/opencode` 底下**同時最多看到 3 個 `t4b` 開頭資料夾**(跑完清掉,所以只在跑的當下抓得到);i9 上那資料夾若不存在,基底會 `ENOENT` | 8/8 綠;`/tmp/opencode` 底下最多 0 個東西;沒留 `lc-gates-pinned-` 在 `/tmp` |
| 4 | `NO_COLOR` | i9 乾淨簽出,`env -u NO_COLOR -u FORCE_COLOR`:degraded-report + run-tests 兩檔 **紅 1 條**,只有 scripts/degraded-report.test.ts 第 954 行第 22 欄(基底行號)——`expect(r.stdout).toMatch(/Test Files\s+1 passed/)` 失敗:`AssertionError: expected '▶ DEGRADED_WITNESS_DIR=reports/degrad…' to match /Test Files\s+1 passed/`(收到的 vitest 輸出是 `Test Files  1 passed (1)` 被色碼切開)。`run-tests.test.ts` 本來就綠。 | 兩檔 **161/161 綠**(同樣 `env -u NO_COLOR -u FORCE_COLOR`) |
| 5 | 拿掉 i9 鏈腳本那兩行後整鏈 | 工單第 6 點是合併後協調者做,**不在這次驗收範圍** | — |
| 6 | 斷言沒放鬆 | 見第 2 節 | 見第 2 節 |

筆電補充:同樣的 `env -u NO_COLOR` 在筆電基底是**綠**(81/81)。色碼只在 i9 出現,所以這題要在 i9 量,筆電量不到。

## 4. 自選改壞(筆電,空 HOME,單檔;每次改完還原)

| # | 改什麼 | 結果 |
|---|---|---|
| M1 | review.test 的 `xdgFor` 回傳拿掉 `XDG_CONFIG_HOME` | **紅**:`指標檔不存在:…/.config/llm-learning-cards/vault.json`(同一條,基數那條) |
| M2 | 同函式拿掉 `XDG_CACHE_HOME` | **測試不紅**,但 HOME 多出 `.cache`(1 個資料夾)——靠「跑完數 HOME」才抓得到,沒有測試守 |
| M3 | review-router 的 `run` 拿掉 `XDG_CACHE_HOME` | 測試不紅,HOME 多出 `.cache`(1 個資料夾),同 M2 |
| M4 | check-gates-pinned 的 `TEMP_BASE` 改回寫死 `/tmp/opencode` | 測試不紅(沒有測試守這個);要靠第 3 節的監看法抓 |
| M5 | `vault-id` 檔寫的 id 與指標檔不同 | **紅**:`帳本身分標記與指標檔的 vault_id 不符` |
| M6 | check-gates-pinned 子行程拿掉 `TMPDIR` | 測試不紅(8/8),HOME 乾淨——子行程的 `TMPDIR` 這行目前沒有被任何測試守 |
| M7 | degraded-report 三處 `NO_COLOR` 只拿第 1 處(約 387 行) | 綠(81/81)——單獨拿掉沒有測試紅 |
| M8 | 只拿第 2 處(約 609 行) | 綠(81/81)——同上 |
| M9 | 只拿第 3 處(約 822 行,「宣稱 --full」那組) | **i9 紅 1 條**(80/81);筆電因為本來不出色碼,綠 |

意思:`NO_COLOR` 三處裡**只有第 3 處(約 822 行)真的讓測試變綠**;第 1、2 處是保險,拿掉也不紅。M2/M3/M4/M6 這幾個「環境隔離」的改壞,現有測試本身抓不到,只有工單驗收表裡的「空 HOME 前後比」和「監看 `/tmp/opencode`」抓得到——這符合工單寫的驗收方式(量測,不是測試斷言),但之後有人把 XDG 或 TMPDIR 拿掉不會有測試擋。屬於缺口、**不擋**;工單「D1 乙」(vitest 全域 setup)要不要做,可以看第 5 節的數字。

## 5. 空 HOME 全套 cucumber(i9;只記錄,不是過關條件)

指令:`env -u XDG_CACHE_HOME -u XDG_CONFIG_HOME -u NO_COLOR -u DBUS_SESSION_BUS_ADDRESS HOME=<空目錄> CARGO_HOME=<i9 原本> RUSTUP_HOME=<i9 原本> NODE_OPTIONS=--import=tsx npx cucumber-js --tags "not @manual"`(cargo 的家目錄指回原位,否則 Rust 編不了)。

- 結果:787 個場景:**720 過、1 失敗、66 undefined**(步驟沒寫的),3636 步:3327 過、1 失敗、275 undefined、33 skipped。退出碼 1。
- 不是 pass 的 67 個,依 feature 分:`05-grading/phase-3` 9、`09-lint/phase-2` 10、`docs/integration/i6` 10、`i4` 7、`06-test-card/phase-4` 6、`i5` 4、`i7` 4、`i8` 4、`08-weekly-goal/phase-2` 4、`10-desktop-shell/phase-5` 3、`phase-4` 4、`phase-3` 2。其中唯一「失敗」的是 `05-grading/phase-3` 第一個場景(`Given the network is unavailable and a local model is running` → `還沒有 phase-3 的世界`),其餘都是步驟沒寫。都是還沒做的 phase,與 HOME 無關(沒有與基底對照,只記錄)。
- 跑完 HOME 底下多出:
  - `.cache/llm-learning-cards/`:**9 個 uuid 名資料夾**(沒有 `path-` 名的);
  - `.cache/fontconfig/`:約 30 個檔(瀏覽器字型快取,`@e2e` 場景起 Chrome 的);
  - `.config/google-chrome/`:1 個(`Crash Reports`);
  - `.local/share/applications`、`.local/share/pki`:Chrome 相關;
  - `.npm`:npx 自己的(不算)。
- 意思:`llm-learning-cards` 快取就算本張三處修好,整套 cucumber 跑一次仍會多 9 個 uuid 資料夾(不分是哪個場景,沒有逐場景歸因)。Chrome 那幾個是瀏覽器自己的。D1 乙(vitest 全域 setup)管不到 cucumber;若要封住 cucumber 這 9 個,要另開票讓 cucumber 的 BeforeAll 設 `XDG_CACHE_HOME`。

## 6. 副作用掃描

- `learning/`:前後各一次,64 檔 / `01d84e9c918e1cf4` / 帳本 111 行,**前後相同**。
- 筆電 `~/.cache/llm-learning-cards` 頂層數:前 497、後 497,相同。
- 筆電 `/tmp/opencode` 底下:前 5、後 5,相同(這張只看、不刪)。
- 驗收自己動到的:i9 的 `/tmp/opencode`——我在量測 B2 時,腳本最後一行 `rm -rf /tmp/opencode` 誤刪了它(當時它是個空資料夾,0 個項目),隨即 `mkdir -p` 還原。資料夾的修改時間變成 2026-10-27 14:39,擁有者不變(i9)。**揭露:這是我的疏失,內容為空沒有損失。**
- 暫存:i9 的 `/data/python/wt` 下的簽出、暫存分支、暫存 ref、HOME 暫存目錄、腳本都已刪;筆電 `/tmp/t60h-*` 暫存 HOME 都已刪。
- 檔案內沒有真的 `learning/`、`raw/` 檔名或內容。

## 7. 花費

- LLM 花費 0(沒有打任何模型)。工單預算 `budget_usd: 1`,比值 0。
- 重活:i9 一次全套 cucumber(約 5 分鐘)。

## 結論

通過。沒有阻擋項。

不擋的缺口(給顧問看):
1. XDG_CACHE_HOME(M2、M3)、`TEMP_BASE`(M4)、子行程 `TMPDIR`(M6)被拿掉時,現有測試不會紅;只靠驗收量測抓。
2. degraded-report 的 `NO_COLOR` 三處裡只有第 3 處(約 822 行)有測試守;另兩處是保險。
3. 空 HOME 整套 cucumber 仍留 9 個 uuid 快取資料夾(含 Chrome 殘檔),D1 乙的 vitest setup 管不到。
