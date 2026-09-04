# 01 · data-layer — 下一步

## 目前

| 欄位 | 值 |
|---|---|
| 已完成 | phase-1(2026-09-02)、phase-2(2026-09-03)、phase-3(2026-09-03) |
| 進行中 | phase-4(ADR-042:learning/ 自成 git repo + snapshot) |
| 下一個 | phase-4 的實作 |

## Gate

**phase-4** 需要:phase-1 done(只需要目錄樹存在)。已滿足。

## phase-4 的現況

測試輪已經做完:

- `docs/02-decision-map.md` 的 **ADR-042**
- `features/01-data-layer/phase-4.feature`(13 個場景,全紅)
- `packages/core/src/schema/git-repo.test.ts`(28 個單元測試紅、11 個純函式的綠)
- `packages/core/src/schema/git-repo.ts`:純函式與訊息常數是實的,四個碰 IO 的函式是
  `throw new Error('not implemented')`
- `scripts/snapshot.ts`:CLI 入口寫好了,邏輯本體在上面那四個函式裡
- `packages/core/src/schema/cli.ts` 的 `runInit()`:只有 `TODO(ADR-042)` 註解,行為沒變

下一輪開發 agent 要做的:實作 `isGitAvailable` / `isOwnGitRepo` / `initGitRepo` /
`snapshotLearningDir`,並把 `runInit()` 裡註解掉的那段打開。

## 完成後

11-review-cli 的 phase-2 接上呼叫點(見該資料夾的 FEATURE.md「範圍」)。
`standalone.json` 的 snapshot 入口交給協調者補(見 FEATURE.md 待協調)。
