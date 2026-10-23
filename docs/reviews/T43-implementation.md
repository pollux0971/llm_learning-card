# T43 實作報告

## 第一步金鑰檢查

```
$ echo "${OPENAI_API_KEY:-UNSET}"; echo "${ANTHROPIC_API_KEY:-UNSET}"; ls .env
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

LLM 真呼叫:0。沒有建立或讀取 `.env`,沒有使用任何 provider 金鑰。

## 做了什麼

深入這個走側車四個新動作(`teach.deepen` / `teach.poll` / `teach.cancel` / `teach.back`),Rust 不改。生成在背景跑,請求馬上回,所以考試卡不會整段拿到 busy,取消也送得進去。

- 協定加四個動作與三個錯誤種類(`deepen-floor` / `no-model` / `deepen-failed`)。版本仍是 1。
- 生成在 `packages/core/src/ingest/deepen.ts`:子卡、字數重寫、考題每一個呼叫都是 task `deepen`。考題明講 `maxTokens: TASK_MAX_TOKENS['ingest.questions']`(4096),截斷重試加倍。重用 `generateChildren`(加 task 參數,預設仍是 `ingest.cards`)、抽出來的 `enforceWordLimit`、`generateQuestions`(加 task / maxTokens,ingest 第一次仍不帶 opts)。每個呼叫前問一次要不要停。不改 `packages/core/prompts/`。
- 寫入是同步的一段:先確認卡檔與考題檔都不存在,再 `writeFileAtomic` 寫考題檔、再寫卡檔(內容跟 `renderCardFile` 同一份),然後更新這個分類的圖。圖讀不到就不建、記 warning(建議重跑 ingest)、卡照留。記 `deepened`;有略過另記一筆 warning(只有父卡 id 與張數)。不寫 `state/reviews.json`。
- 麵包屑在側車。下一個在最後一張子卡時,子卡與一路往上的父卡同一次 `saveReviewsIfUnchanged`。回上一層、換類別、跟先備、`teach.open` 照工單第 4 節。主流程與剩幾張只算 level 0、1。先備提示不列麵包屑上的父卡。
- 取消不中斷已經送出的呼叫(不傳 signal),那個呼叫照常記帳;之後不再發呼叫、不寫檔。舊工作收尾時若已不是目前的工作,只留帳。寫完才收到取消不刪檔。生成中再按深入回同一個生成中畫面。已有子卡不查金鑰、不拿 router。
- stdin 結束時 `shutdown()` 把進行中的工作當成取消,然後 `process.exit(0)`,不等手上的呼叫。
- 視窗:`teachDeepen` / `teachPoll` / `teachCancel` / `teachBack`;輪詢用注入的 `pause(500)`。Rust 七種錯誤進出錯畫面(判斷在 `review-client.ts` 的 `isClientLayerError`),其餘留在卡片上。`credential-unavailable` 的取字也在 `review-client.ts`(`deepenErrorText`),`teach-session.ts` 沒有 `.message` / `sleep` / `now` / `setTimeout` / `'busy'`。
- 缺金鑰的兩句走 `credentialMessage(problem, 'deepen')`,批改的兩句不變。
- 單獨執行: `apps/teach-card/dev/fake-cloud.mjs`, `standalone.ts` 的 sidecar 環境設 `LC_REVIEW_FAKE_CLOUD`。深入回兩張合格子卡與考題,模型回應前等約 1.5 秒。

## 跑過的指令與輸出

`npx tsc --noEmit --pretty false`:無輸出,結束碼 0。

`npm run boundaries`:

```
boundaries: 掃描 361 個檔案,允許例外 24 條
涵蓋:納管 417 / 掃描 417 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=361
```

新檔 `deepen.ts`、`teach-deepen.ts` 落在既有目錄前綴裡,`boundaries.owners.json` 不用另登記(工單也這樣寫)。`boundaries.allow.json` 的 11 → 02 例外已在,worker 沒改。

`npx tsx scripts/check-doc-links.ts`:

```
✓ 無壞掉的連結
gate=doc-links result=PASS scanned=131
```

vitest(`CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run --maxWorkers=1`):

- `features/support/t43-handler.test.ts`、`t43-commit.test.ts`、`t43-deck.test.ts`:3 files, 80 passed
- `t43-cancel.test.ts`、`t43-atomic.test.ts`、`apps/teach-card/src/t43-deepen.test.ts`、`apps/desktop/src/review-client-deepen.test.ts`、`packages/core/src/session/protocol.test.ts`:5 files, 225 passed
- `features/support/t43-sidecar.test.ts`:1 file, 13 passed
- `apps/teach-card/dev/t43-standalone.test.ts`:1 file, 3 passed
- 不退步抽測:`teach-session.test.ts`、`t40-busy.test.ts`、`t37-handler.test.ts`、`t37-conflict.test.ts`、`t30-sidecar.test.ts`、`children.test.ts`、`children-siblings.test.ts`、`questions.test.ts`、`generate-cards.test.ts`、`generate-cards.regenerate.test.ts`、`generate-cards.word-authority.test.ts`、`credentials.test.ts`、`review-client.test.ts`、`review-client-teach.test.ts`、`review-client-busy.test.ts`、`phase2-static.test.ts`:全綠

cucumber(`CARGO_BUILD_JOBS=2 NODE_OPTIONS=--import=tsx npx cucumber-js --format summary`):

- `--tags '@teach-card and @phase-3 and not @manual'`:8 scenarios passed, 49 steps passed
- `--tags '@teach-card and @phase-2 and not @manual'`:5 scenarios passed, 25 steps passed
- `--tags '@teach-card and @phase-1 and not @manual'`:10 scenarios passed, 41 steps passed
- `--tags '@i2 and not @manual'`:93 scenarios passed, 464 steps passed
- `--tags '@i3 and not @manual'`:190 scenarios, **1 failed**, 189 passed(見待協調)

`CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=2`:通過(最後一個 suite `test result: ok`)。沒改 Rust、沒改 `protocol.vectors.json`。

沒跑 `npm run mutate`、沒跑整條 `check:all`、沒 `git push`。

## git diff --stat

實作檔(不含這份報告):

```
 apps/desktop/src/webview/review-client.ts  |  40 +++++-
 apps/teach-card/dev/standalone.ts          |   1 +
 apps/teach-card/src/App.svelte             |  16 +++
 apps/teach-card/src/main.ts                |   9 +-
 apps/teach-card/src/teach-session.ts       | 137 +++++++++++++++++++-
 packages/core/src/ingest/children.ts       |  19 ++-
 packages/core/src/ingest/generate-cards.ts | 101 +++++++++++----
 packages/core/src/ingest/questions.ts      |  25 +++-
 packages/core/src/llm/credentials.ts       |  11 +-
 packages/core/src/session/handler.ts       |  63 ++++++++-
 packages/core/src/session/protocol.ts      |  14 +-
 packages/core/src/session/teach.ts         | 200 +++++++++++++++++++++++++----
 packages/core/src/teach/deck.ts            |  68 ++++++++++
 scripts/review-sidecar.ts                  |   2 +
 14 files changed, 628 insertions(+), 78 deletions(-)
```

另加新檔:`packages/core/src/ingest/deepen.ts`、`packages/core/src/session/teach-deepen.ts`、`apps/teach-card/dev/fake-cloud.mjs`。

`git diff --name-only` 看不到 `packages/core/prompts/`、`contracts/`、`apps/desktop/src-tauri/`、`*.test.ts`、`features/steps/**`、`features/support/**`、`.feature`、`protocol.vectors.json`。

## 待協調

`features/steps/test-card-phase2-sidecar.steps.ts` 第 128 行把 `ReviewClient` 的 `Object.keys` 釘成 T43 之前的十個名字。四個新方法(`teachDeepen` / `teachPoll` / `teachCancel` / `teachBack`)都不收路徑或卡 id(`length === 0`,params `{}`),但這行深相等沒把牠們算進去,所以 `@i3 and not @manual` 的 Scenario「The review helper takes only review actions」紅。這是受保護的步驟檔,worker 沒改。請測試 agent 把四個名字加進那行斷言(工單「要改的既有測試」那一類:釘住方法清單)。其餘 i3 189 個情境是綠的。

prompt 模板夠用,沒有要改 `packages/core/prompts/` 的事。
