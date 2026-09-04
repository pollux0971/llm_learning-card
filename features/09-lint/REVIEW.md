# REVIEW — 09-lint

## 五支 0 值守門(分支 `five-zero-guards`)—— `scripts/lint.ts --dir` 這一支的摘要

完整報告在 `features/03-llm-router/REVIEW.md` 的「五支 0 值守門」一節(五支跨五個 feature,
報告只放一份)。這裡只留跟 09 有關的結論:

- **審核對象**:`7622381`(`scripts/lint.ts`:`--dir` 指到不存在的目錄或指到檔案 → exit 1,
  **不建目錄、不留報告**,指出用 `cli.ts init` 建)。
- **結論**:**PASS**。實跑確認不建目錄、沒有 `<dir>/state`、不說「0 problems」;
  沒給 `--dir` 仍 exit 2。
- **這一輪動了的測試**(`scripts/lint-missing-dir.test.ts`):開發 agent 自己點出的假綠屬實——
  「路徑是檔案」那條守門整條刪掉測試照樣綠(沒守門會掉進 `mkdirSync(<file>/state)` 的
  ENOTDIR,一樣 exit 1、一樣不印 0 problems)。補了一條分得出「守門句」與「掉進例外」
  的測試(含 `不是目錄` + 路徑 + `init`、不噴 stack、不含 ENOTDIR);刪守門重跑會紅,
  輸出在完整報告 §3。另補「目錄不存在」那條的不噴 stack、用法含 `用法`、
  守門不誤傷真的目錄。
- **Stryker**:`npm run mutate -- stryker.zero-guards-lint-guard.json`(守門 L20–49)
  → 37.50% → **100.00%**(23 / 0);全檔 `stryker.zero-guards-lint.json` → 41.46% → **70.73%**
  (29 殺 / 12 活)。12 個活的有 11 個在 `lint()` 之後的寫報告路徑——那半邊 main 已有
  `scripts/lint.test.ts` 蓋,本 base 沒有,不在這裡重寫一份;剩 1 個是 `argv` 索引
  不可能是 0 的等價變異。

⚠️ 合併提醒(開發 agent 的 commit 也寫了):main 的 `a45e441` 在同一位置有「目錄不存在」
守門,兩邊差一句 init 提示,取本分支這版。
