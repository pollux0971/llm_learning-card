# 07 · teach-card — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-4(2026-10-25:T46 折疊與圖片放大、T47 縮放與黏底與視窗、T48 修補〔圖片放大層〕、T49 修補〔黏底塊不透明、不留縫〕;@manual `docs/reviews/T46-manual-2026-10-24.md`、`docs/reviews/T47-manual-2026-10-24.md`、`docs/reviews/T49-manual-2026-10-25.md` 顧問判通過;F2〔捲到底按鈕上移 1.29 px〕交 T50 小票)、phase-3(2026-10-24:T43 實作〔背景生成、可取消〕、T44 修補〔生成中的畫面跟著更新〕;@manual `docs/reviews/T43-manual-2026-10-24.md`〔F1/F2 不過〕與重做 `docs/reviews/T44-manual-2026-10-24.md`〔全過〕顧問判通過)、phase-2(2026-10-23:T37 實作、T40 修補〔兩視窗共用側車〕;@manual 重做 `docs/reviews/T40-manual-2026-10-23.md` 顧問判通過)、phase-1(2026-09-03) |
| 進行中 | 無 |
| 下一個 | T50(捲到底按鈕上移 ≤ 1 px,小票);07 資料夾 phase 全 done,屬 I4 的關鍵路徑之一 |

## Gate

**phase-1**:無 gate。

**phase-2** 需要:
- [ ] 自身:phase-1 `done`
- [ ] 跨資料夾:01 phase-3 `done`、10 phase-2 `done`
- [x] 整合:無(桌面複習的自動驗收已通過,理由見下)

理由:2026-10-21 技術顧問判 I3 自動驗收通過(ADR-073,不打 tag;證據 `docs/reviews/T34-manual-2026-10-21.md`)。

**phase-3** 需要:phase-2 `done`、03 phase-2 `done`、02 phase-2 `done`
**phase-4** 需要:phase-1 `done` 即可

## Gate 未滿足時

**phase-4 是例外——它不必等。** 範例折疊、縮放、圖片放大都只依賴 phase-1 的渲染,
不碰任何其他模組。如果 phase-2 卡住而你想推進這個資料夾,**做 phase-4**。

**phase-2 卡住**:等桌面複習的自動驗收(ADR-073)。這段時間把 fence 插件的解析測到 80% 變異分數——
那是唯一會被兩張卡共用的邏輯,錯了會錯兩次。

## 完成後

四個 phase 完成即 I4。到這裡兩張卡完整運作,Obsidian 可以關掉了。
