# 驗收證據:T65 缺口補測(G4/G5、JSON null、warning 欄位)

- 被驗分支:t65-gaps,0a014a8fb9e64aad753413cdeb97d5cf30b7ce4c(基底 1652811)
- 開跑與跑完的 tree sha:205021e9cfbf1180f305f8ba6fe173c3d9e69b98
- 日期:2026-10-27。筆電輕驗(沒用 i9)。LLM 花費 0。沒有 `.env`。

## 範圍與作者

- 對基底只有 1 檔新增 186 行:packages/core/src/grading/reteach-short-gaps.test.ts(1 個 commit)。實作、prompt、其他測試 0 變動。tracked 檔沒有 mutants 輸出夾(計數 0)。
- 沒有 prompt 或實作變動,不用整鏈。

## 基準(現有實作)

- 新檔 17 條 + 原 reteach-short.test.ts:2 檔 68/68 過。tsc 乾淨。boundaries PASS(掃 408 檔)。

## 自選改壞(只改 reteach-short.ts,不在 -a6 的 8 個清單上)

| # | 改法 | 結果 |
|---|---|---|
| N1 | 來回檢查比對時不 trim 模型的 example | 紅 1 |
| N2 | overlong 警告改成 `>=`(剛好等於上限也警告) | 紅 1 |
| N4 | 拿掉 example 空字串檢查 | 紅 2 |
| N5 | 挑最短改成挑最長 | 紅 4 |
| N6 | 拿掉「是陣列」的守門 | 存活(等價:陣列沒有 body 與 example 字串屬性,下一行的型別檢查照樣回 null) |
| N7 | 「上一次 N 字」的 N 改印上限 | 紅 6 |
| N9 | 提前停改成 `<` 上限(等於上限不停) | 紅 3 |
| N10 | 「examples 剛好 1 個」改成「不是 0 個」 | 紅 3 |
| N11 | 壞格式那次的 N 沿用舊值(只在有值時更新) | 紅 1(補的是 G5 那條,上次 H1 存活現在抓到) |
| N12 | 拿掉 body 空字串檢查 | 紅 3 |

10 個裡 9 個紅,1 個等價。每次還原後檔案乾淨。上次的缺口 G4、G5(含 H1)、JSON null、warning 欄位都有條目抓到。

## 資料前後

- 這批只在筆電的獨立簽出跑單檔 vitest,沒碰 learning/。簽出已移除。

## 結論

通過,沒有阻擋項。
