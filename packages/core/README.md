# packages/core — 落點表

每個功能一個子目錄。**Wave 0 期間只准 import 自己的目錄與 `contracts/`、`packages/contracts/`**
(`npm run boundaries` 檢查,規則在 `scripts/check-boundaries.ts` 的 `OWNERS` 表)。

| 功能 | 程式碼落點 | CLI 入口 | Wave 0 的 stub 也放這裡 |
|---|---|---|---|
| 01-data-layer | `packages/contracts/src/`、`src/schema/` | `src/schema/cli.ts` | — |
| 02-ingest-pipeline | `src/ingest/`、`prompts/` | `scripts/ingest.ts` | `src/ingest/fake-llm.ts`、`src/ingest/word-count-min.ts` |
| 03-llm-router | `src/llm/` | `scripts/llm.ts` | `src/llm/log-min.ts` |
| 04-scheduler | `src/scheduler/` | `scripts/due.ts` | — |
| 05-grading | `src/grading/` | `scripts/grade.ts` | `src/grading/fake-llm.ts` |
| 06-test-card | `apps/test-card/` | — | `apps/test-card/src/stubs/` |
| 07-teach-card | `apps/teach-card/`、`packages/ui-shared/` | — | `apps/teach-card/src/stubs/` |
| 08-weekly-goal | `src/weekly/` | `scripts/weekly.ts` | — |
| 09-lint | `src/lint/`(**不 import `src/schema/`**) | `scripts/lint.ts` | `src/lint/validator-min.ts` |
| 10-desktop-shell | `apps/desktop/` | `npm run tauri` | `apps/desktop/src-tauri/placeholder/` |
| 11-review-cli | `src/session/`(不在 Wave 0) | `scripts/review.ts` | — |
| 12-prompt-quality | `src/prompt-quality/` | `scripts/prompt-check.ts` | — |

`scripts/check-*.ts`、`scripts/snapshot.ts` 與 `features/steps/` 是膠水,不受限制。

## 慣例

- 測試跟原始碼放一起:`src/scheduler/select.ts` + `src/scheduler/select.test.ts`
- 匯出走目錄的 `index.ts`;`stryker` 不變異 `index.ts`
- 從 `scripts/*.ts` import core 用相對路徑(`../packages/core/src/scheduler/index.js`)
  或 `@core/scheduler/index.js`;tsx 兩種都吃
- 整合後要跨功能 import:把邊加進 `scripts/boundaries.allow.json`,附理由

## 共用檔:只有協調者改

`package.json`、`package-lock.json`、`tsconfig.json`、`cucumber.js`、`standalone.json`、
`features/steps/_world.ts`、`features/steps/common.steps.ts`、`docs/01-roadmap.md`、
`docs/02-decision-map.md`。worker 需要動這些,寫在自己 FEATURE.md 的「待協調」段,合併時處理。
