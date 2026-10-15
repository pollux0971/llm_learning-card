# 驗收證據:T11 golden run 的 meta 不能把 dirty 的 prompt 記成乾淨的 commit

驗收角色:-ed(測試 agent 兼驗收)。日期:2026-10-15(Asia/Taipei)。host:`pollux-IdeaPad`,8 cores。
被驗分支:`t11-opencode` @ `e00087d`,base `ea0d62b`(`origin/main` `bf84ce3` 加 -e5 的 `270aae2`、`ea0d62b` 兩個紅測試 commit)。
worker 三個 commit:`733eaa2` 實作、`011fb22` 報告、`e00087d` 報告補超額花費。實作者:opencode grok-4.7(名目 $5.08,工單預算 $2 ≈ 2.5×,不設上限只記錄)。
我的補測在其上的分支 `pollux0971/t11-accept-tests`;所有突變都在驗收用簽出做、事後還原。
我只交證據與測試。不合併、不 push、沒改 worker 的實作檔。

## 0. 結論

**實作沒有阻擋項。** 工單十條 `must_catch` 都有會紅的測試,實作全綠(prompt-quality 292 條)。
測試端兩類缺口,補完之後 18 條我自選的突變全紅(§3):

| # | 等級 | 項目 | 狀態 |
|---|---|---|---|
| F-1 | 缺口,已補 | 路徑邊界的兩個方向沒測:`golden/..hidden`(名字以兩個點開頭,在 golden/ 底下)與 `golden/` 的上一層(在外面)。突變 Q2(`startsWith('..')`)與 Q3(拿掉 `rel === '..'`)原本存活:前者讓 dirty 的 prompt 能寫進 `golden/..hidden`,後者誤拒絕上一層 | 補 3 條,兩個突變紅 |
| F-2 | 缺口,已補 | **witness 未標記 153 > 基準 152**(多 1,gate 會紅):-e5 的 4 條與我的補測 2 條在 fake 模式沒給 router,各觸發一次 `prompt-quality.router-default-fake`。實作沒有造成這個——是測試沒明確給 router | 這 4 條(`dirty-prompt.test.ts` 兩條 fake 的、我的補測)明確傳 router;未標記降到 **149**。CLI 那兩條無法注入 router,留著(與既有 `cli.test.ts` 同類) |
| F-3 | 備註,給顧問 | 沒追蹤的新 prompt 檔記成 `uncommitted`(沒有 `-dirty`),可以寫進 `golden/`:grok 審查提出來。**這是工單明文的**(「沒追蹤或還沒有 commit:維持 `uncommitted`」),不是漏洞,但「基準必須能用某個 commit 的 prompt 重現」的理由其實也適用於沒追蹤的檔案。要不要擴大規則是顧問的事 | 不處理 |
| F-4 | 備註,給顧問 | git 本身壞掉(`git log` 失敗)時 `gitCommitOf` 回 `uncommitted`,不是 `-dirty`:偵測不到 dirty。既有行為,真的 repo 裡 git 正常;不處理 | 無 |
| F-5 | 成本 | worker 名目 $5.08;預算 $2(≈ 2.5×,超過 2× 旗標線),使用者裁決 grok 不設花費上限,只記錄 | 記錄 |

## 1. 乾淨簽出與測試作者檢查

- 驗收簽出 `acceptance-t11`(基於 `t11-opencode`),沒有 `.env`。
- **測試作者檢查**:`git diff --name-only ea0d62b e00087d` 中 `*.test.*`、`/tests/`、`test-support/`、`features/steps/**`、`.feature`、`contracts/fixtures/**` 的變動共 **0** 個;worker 只動 `golden-run.ts`、`cli.ts`、`types.ts` 與報告。`golden/`、`prompts/` 沒被動(0 個檔)。
- **所有呼叫端**(`git grep` 含 `.ts`、`.mjs`、`.js`、`.json`):`gitCommitOf`、`defaultGoldenBaseDir`、`DEFAULT_GOLDEN_BASE_DIR` 只在 `golden-run.ts` 與 `cli.ts` 內;`runGolden` 另被 `features/steps/prompt-quality*.steps.ts` 呼叫,它們不傳 `root`,走 `ROOT` 預設——行為不變(cucumber 的 prompt-quality 場景全綠)。沒有 `.mjs`/`.js` 的呼叫端。
- 驗收前後 `learning/`(唯一量法):**64 檔 / `ee37f9e1fa9193c6` / 70 行**,前後相同(與 `bf84ce3` 記載的 golden run 之後的基準一致;我只讀)。

## 2. 基準(未突變)

| 項目 | 結果 |
|---|---|
| `packages/core/src/prompt-quality`(vitest) | 14 檔 292 條綠;加我的補測後 295 條 |
| 全部 vitest(`witness:degraded` 內含) | 3700 條綠、168 跳過、0 紅 |
| cucumber 全 feature | 759 場景(263 undefined、496 passed、0 failed);undefined 是之後 phase 才寫步驟的場景,與 base 相同 |
| `npx tsc --noEmit` | 0 錯 |
| `npm run boundaries`、`npm run lint:docs` | PASS(掃描 250、47 條連結) |
| `witness:degraded` | 第一次 未標記 153(F-2,超過基準);修測試後 **149**(基準 152,可降到 149);目錄/呼叫點/觸發 27/27/27;跨擁有者 12 |
| 併進最新 main(`63e4dc6`) | `git merge-tree`:無衝突 |

## 3. 工單 `must_catch` 的突變(我自選,避開 -e5 自己做的 16 條)

做法:改一處實作 → 跑 `packages/core/src/prompt-quality` 全部測試(292 條)→ 記紅 → `git checkout` 還原。重點:`realpath` 與「baseDir 不存在取最近存在祖先」那段、拒絕發生在任何 `router.call` 與 `mkdir` 之前、既有呼叫不傳 `root` 時行為不變。

| 目標 | 突變 | 結果 |
|---|---|---|
| 不存在的路徑取最近存在祖先做 realpath | Q1 不做 realpath、直接用 `resolve`;Q4 golden/ 自己的位置不做 realpath(root 是 symlink 時) | 全紅 |
| 路徑邊界(不是字串前綴) | Q2 `startsWith('..')`;Q3 拿掉 `rel === '..'` | **原本存活**(F-1);補測後紅 |
| 拒絕不分 mode | Q5 只在 live 拒絕;Q6 只在 fake 拒絕 | 全紅 |
| `root` 一路傳下去 | Q7 預設存放處忽略 `root`;Q11/Q12/Q13 git 的三個呼叫其中一個固定問 `ROOT`;Q14 prompt 檔從 `ROOT` 讀 | 全紅 |
| 訊息與錯誤類別 | Q9 訊息不提 `--out`;Q10 不提 prompt 檔名;Q15 `name` 寫錯 | 全紅 |
| CLI | Q8 拒絕時退出碼 0 | 紅(2 條) |
| dirty 偵測 | Q16 後綴大小寫;Q17 沒 commit 的標成 `uncommitted-dirty`;Q18 只認特定 git 退出碼 | 全紅 |

**拒絕之前沒有副作用**:-e5 的測試守著(router 呼叫次數 0、`golden/` 沒長出任何目錄);我讀實作確認 `commitForRun` 在 live 路徑裡位於建立 router(預設路徑會 `mkdir state/`)、`probeOnline`、`router.call`、`mkdir` 之前,fake 路徑位於 `mkdir` 之前。

Q 系列裡幾條突變會讓程式真的寫進工作區的真 `golden/`(Q5–Q7 等)——-e5 的 `afterEach`「真的 golden/ 前後相等」正是為此而設,它有紅;我另外在跑完後清掉驗收簽出裡殘留的未追蹤 `golden/selftest/`(驗收簽出裡的突變殘留,沒進任何 commit)。

## 4. 對抗審查(grok-4.20)

第一次逾時沒輸出,重試成功。六條主張:(1) 沒追蹤的新 prompt 檔不算 dirty——工單明文要求維持 `uncommitted`(F-3);(2) `root` 與 `baseDir` 指向不同 repo 時繞過——`root` 就是 repo 根,不一致是呼叫端錯誤,測試專用參數;(3) 檢查之後、`mkdir` 之前換 symlink 的競態——單人本機工具,TOCTOU 接受(`path.join` 與檢查用同一種字面正規化,兩者一致);(4) git 壞掉時偵測不到 dirty——既有行為(F-4);(5) 祖先是懸空 symlink 時 `realpathSync` 丟錯——**不成立**:`existsSync` 對懸空 symlink 回 false,迴圈繼續往上找,`realpathSync` 只對存在的路徑呼叫;(6) 建立 router 前的副作用——實作把檢查放在 router 之前,測試守著。沒有成立的繞過。

## 5. 補測

我的 commit(`pollux0971/t11-accept-tests`):`dirty-prompt-boundaries.test.ts`(新,3 條:`golden/..hidden`、`golden/` 上一層、兩端與兄弟目錄);`dirty-prompt.test.ts` 兩條 fake 測試明確傳 router(F-2)。

## 6. 成本

worker 名目成本 $5.08;工單 `budget_usd: 2`;比值 **≈ 2.5×**,超過 2× 旗標線,已在此標出。使用者裁決 grok 不設花費上限,只記錄。
