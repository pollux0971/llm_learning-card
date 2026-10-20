# T34 A 的改壞證明(整合層五條場景)

- 工單:`../tickets/T34-i3-integration-steps-and-wayland-note.md`(must_catch 前五條、驗收 A「改壞證明要穩」)
- 被測:main `db558ee`(步驟定義 `features/steps/i3-desktop-review.steps.ts`,測試一個字沒改)
- 做法:丟棄的 worktree、一次一個文字改壞、跑
  `cucumber-js --tags '@integration and @i3 and not @manual'`(`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1`),跑完 `git checkout --` 還原。改壞不進 git。
- 對照組(沒改壞):6 場景 / 33 步全綠。
- learning/ 前後(檔案雜湊前 16 碼 / 檔案數 / 帳本行數):`c2e4dd6d71de3976` / 64 / 108,前後相同。

## 五條 must_catch

| # | 改壞的地方 | 紅的場景(6 個裡) | 結果 |
|---|---|---|---|
| 1 | `session/io.ts` `saveReviewsIfUnchanged`:寫檔延到行程結束(`process.once('exit')`) | Answers are written immediately、same session、same state、terminal loop(I2) | 4 紅 |
| 1′ | 同處:回應之後才寫(`setTimeout(..., 0)`) | Answers are written immediately、terminal loop(I2) | 2 紅 |
| 2 | `session/handler.ts` `handleStart`:側車的 queue 反過來 | same session、same state | 2 紅 |
| 3a | `session/cache.ts` `writeSessionCache`:側車不寫當日快取 | same state | 1 紅 |
| 3b | `session/cache.ts` `sessionCacheFolder`:側車寫到別的 vault 資料夾 | same state | 1 紅 |
| 4a | `learning_fs.rs` `guard`:拿掉 `check_rel_path`(白名單) | File access goes through the Tauri boundary | 1 紅 |
| 4b | 同處:拿掉 `inside`(symlink / 根外) | File access goes through the Tauri boundary | 1 紅 |
| 4c | 同處:兩道都拿掉 | File access goes through the Tauri boundary | 1 紅 |
| 5 | `scripts/review.ts`:送出後題目不前進(把剛答完的卡放回 queue 頭) | The terminal review loop still works as in I2 | 1 紅 |

「The window and the terminal produce the same session」只被 1(延到結束)與 2 抓到;3a / 3b 只被 same state 抓到,這是各自守的東西不同,不是漏。

## SIGKILL 那條(Answers are written immediately)

只跑該場景(同樣用 `--tags`,加 `--name`),每個改壞版本連跑 10 次:

| 改壞版本 | 紅 |
|---|---|
| 1′ 回應之後才寫(`setTimeout 0`,搶時間型) | **10 / 10** |
| 1 寫檔延到行程結束(保證會紅型) | **10 / 10** |
| 沒改壞 | 1 / 1 綠 |

兩個版本都 10/10,不用換法。1′ 之所以穩:步驟在拿到 submit 回應之後立刻對側車行程送 SIGKILL,寫檔排在下一輪事件迴圈,SIGKILL 先到。

守的退步:
- 1′:「submit 回應之後才落地」(回應跟寫檔之間有空窗,此時被殺就掉資料)。
- 1:「只在 summary / 結束時才落地」(根本不是每題即時寫)。

## 備註

- 步驟定義沒改,不用 -0e 重驗那一段。
- 改壞用的是文字替換,沒有 commit;`mutants.out` 沒有出現。
