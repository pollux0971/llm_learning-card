# 14 · hud-skin — 下一步

> 這份檔案指揮 AI 何時進行下一個 phase。`/sprint` 會讀它決定 ready。
> 每次 `/phase-done` 之後更新「目前」與「下一步」。

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | 無 |
| 進行中 | 無 |
| 下一個 | phase-1 |

## 下一個 phase 的 gate

**phase-1** 需要:

- [x] 自身:無(第一個 phase)
- [x] 整合:無
- [x] 契約:無(純外觀,不動磁碟格式、不動 `contracts/`)

不碰 `apps/desktop/`,所以跟 T2c-2 可以同時做(R2 只管同一個目錄)。

**phase-2** 需要:

- [ ] 自身:phase-1 `done`
- [x] 跨資料夾:06 phase-1、07 phase-1 `done`
- [ ] 設定:`scripts/boundaries.allow.json` 開「06→14」「07→14」兩條例外(ADR-071;協調者改;理由見 FEATURE.md「依賴」)
- [ ] 排程:跟 06、07 的 I3 接線(06 phase-2/3、07 phase-2)誰先,由協調者排;同一時間只有一個人改 `apps/teach-card` 或 `apps/test-card`
- [x] 整合:無
- [x] 契約:無

## Gate 未滿足時

- phase-1 等排程時:什麼都不用先做。設計值已寫在 FEATURE.md,開工就照那張表。
- phase-2 等 boundaries 例外或排程時:可以先在展示頁裡用 fixture 把「教學卡長這樣」「考試卡長這樣」排出來給 UI/Tauri 負責人看,
  但**不要改** `apps/teach-card`、`apps/test-card` 的檔(那時可能有人在做 I3 接線)。
- 視窗無框(拿掉系統標題列)不在這裡,在 10 phase-6。phase-2 做完、10 phase-6 還沒做的時候,
  桌面殼不會加 `hud-frameless`,所以自畫的標題列與縮放把手不顯示,只有系統標題列:不會出現兩條標題列。

## 完成後

- 10 phase-6(無框視窗)的跨資料夾 gate 解開:它需要兩張卡都已經用上本資料夾的標題列、縮放把手與兩個 class 的畫法,
  否則拿掉系統外框之後視窗沒有地方可以拖、也關不掉。
- 之後 06、07 的新畫面一律用本資料夾的元件,不各自畫框。
