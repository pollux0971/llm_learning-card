# 批次 G:lc-fs 每次重編的共用 helper(測試 agent)

日期:2026-10-15。基底 `batch-g` @ `953e679`。分支 `pollux0971/g-build-lc-fs`。

## 問題

`apps/desktop/src/builtin-asset.test.ts` 透過 `shell-config.ts` 的 `requestBuiltinAsset` 直接 spawn 預先編好的
`apps/desktop/src-tauri/target/debug/lc-fs`。在全新簽出上沒有這個檔;`check:all` 的鏈裡 vitest 比 cucumber 的
`BeforeAll` 重編還早跑,所以 ENOENT。檔在但是舊的情況(上一輪留下的)也一樣會測到舊行為。

## 修法

- 新增 `apps/desktop/src/test-support/build-lc-fs.ts`:`buildLcFs()` 每次都跑 `cargo build --bin lc-fs`(cwd `apps/desktop/src-tauri`),
  失敗就把 cargo 的完整輸出印出來並丟錯;不做「缺檔才編」或「缺檔就紅」。`BUILD_LC_FS_TIMEOUT_MS = 180_000`。
- `apps/desktop/src/builtin-asset.test.ts`:`beforeAll(() => buildLcFs(), BUILD_LC_FS_TIMEOUT_MS)`(vitest 預設 hook 只有 10 秒)。
- `features/steps/desktop-shell-phase2.steps.ts`:cucumber 的 `BeforeAll` 改呼叫同一個 helper,原本內嵌的 spawnSync 邏輯刪掉,不留兩份;同時拿掉不再用的 `spawnSync` import。
- 鏈的順序與 `package.json` 不動。

## 會走到 lc-fs 的測試完整清單(`git grep` 實測)

`lc-fs` 的 BIN 常數只在兩處:`apps/desktop/src/boundary.ts` 第 38 行與 `apps/desktop/src/shell-config.ts` 第 35 行。
- vitest:`apps/desktop/src/builtin-asset.test.ts`(import `shell-config.ts`)。這是 `apps/`、`packages/`、`scripts/` 底下**唯一**會走到 lc-fs 的 `*.test.ts`。
- cucumber:`features/steps/desktop-shell-phase2.steps.ts`(import `boundary.ts` 與 `shell-config.ts`)。`boundary.ts` 沒有任何 vitest 測試 import。

## 對照

| 項目 | 結果 |
|---|---|
| (a) 沒有 `target/`(全新簽出,`ls apps/desktop/src-tauri/target` → No such file),單跑 `npx vitest run apps/desktop/src/builtin-asset.test.ts` | 3 passed,耗時 55.6 秒(冷編譯) |
| (b) 改 Rust 一行(`lc-fs.rs` 第 71 行 `refused: true` → `refused: false`),**不手動重編**,單跑同一個檔 | 紅:`× an asset: URL for a file inside learning is refused and the file is not read`,`AssertionError: expected false to be true`。還原 Rust 後不手動重編再跑 → 3 passed |
| (c) 編譯失敗(`refused: nope`) | 印出 cargo 輸出(`error[E0425]: cannot find value \`nope\` in this scope`),丟 `cargo build --bin lc-fs 失敗 status=101`,3 個測試被跳過(測試紅) |
| cucumber `features/10-desktop-shell/phase-2.feature`(設定檔會跑全部 feature) | `lc-fs rebuilt: … Finished …`;677 scenarios(241 undefined、436 passed),3161 steps,與改之前逐數相同 |
| `npx tsc --noEmit` | 0 錯誤 |
| `npm run boundaries` | PASS,掃描 222 |
| `npm run check:steps` | PASS,scanned=2309 |
