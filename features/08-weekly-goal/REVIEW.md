# REVIEW — 08-weekly-goal

## 五支 0 值守門(分支 `five-zero-guards`)—— `scripts/weekly.ts` 這一支的摘要

完整報告在 `features/03-llm-router/REVIEW.md` 的「五支 0 值守門」一節(五支跨五個 feature,
報告只放一份)。這裡只留跟 08 有關的結論:

- **審核對象**:`0159186`(`scripts/weekly.ts`:合法 JSON 但不是 Weekly → exit 1,說它實際
  是什麼,不再憑空補一份看起來有進度的 Weekly;schema 在
  `packages/core/src/weekly/validate.ts`)。
- **結論**:**PASS**。`{}` / `[]` / `"hi"` / `42` / `null` / 少欄位 / 型別錯 → exit 1,訊息含
  `Weekly`、`它實際是:<前 80 字>`、`第一個對不上的地方:…`,stdout 乾淨;
  壞 JSON 與缺檔那條「讀不到」路徑沒動,回歸鎖仍綠。
- **這一輪動了的測試**(`scripts/weekly.test.ts`):
  1. 那條「數學上不可能同時成立」的測試——照協調者裁定**換 fixture**
     (`learned` 是字串的案例改成不含 `"passed_d1"` 的原檔),斷言語意不動。
  2. 換掉之後失去的「型別錯 + 原檔本身就有 `passed_d1`」組合,**另外補一條**,
     不用子字串當代理指標:直接看 stdout 是空的、回聲只在 stderr。
  3. 「不是 Weekly」與「讀不到檔」的訊息比較改成路徑正規化後比(清空兩句會紅)。
- **Stryker**:這一批的工單沒有要求 weekly 的分數,本輪沒跑;`parseWeekly()` 的
  變異測試歸 08 phase 驗收時一起跑(`packages/core/src/weekly/`)。
