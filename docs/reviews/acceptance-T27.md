# 驗收證據:T27 presentNextCard 單檔 Stryker 的 12 個存活逐個判決與補測

驗收角色:-ed(測試·驗收)。日期:2026-10-17(Asia/Taipei)。
性質:低優先小單(顧問派、協調者配號 T27),只補測試、不用 worker、不動實作。基底:main `18672ad`(= 協調者推的 e77e766 之後的本地 main,present.ts 沒有任何改動)。
補測在 `pollux0971/t27-accept-tests`:一個測試檔 `packages/core/src/session/present-acceptance.test.ts`(8 條)加這份證據。

## 0. 結論

T25 驗收時 Stryker 對 `packages/core/src/session/present.ts` 是 **78.57%、12 個存活**(都在 phase-1 既有的「題目呈現」程式)。逐個判斷:**12 個全是缺口、沒有等價**(顧問點名的 pickQuestion fill / apply 分支確實是缺口)。補 8 條測試後 **100.00%(56 殺、0 活)**。

| 量法 | 補測前 | 補測後 |
|---|---|---|
| 測試 = `present*.test.ts` 四個檔(只靠 present 自己的測試,重現 T25 時的 78.57%) | **78.57%**(44 殺 / 12 活) | **100.00%**(56 殺 / 0 活) |
| 測試 = session 目錄全部 `*.test.ts`(含 T26 之後新增、會經過 presentNextCard 的測試) | 98.21%(55 殺 / 1 活:`queue[0]?.card` 的可選鏈) | **100.00%**(56 殺 / 0 活) |

為什麼兩列補測前差這麼多:T26 的 `reviews-optimistic.test.ts` 等新測試會建 session、呈現並作答應用題,**順便**殺掉了 11 個,但那是附帶的覆蓋,不是 present.ts 自己的測試在守;一旦那些測試改了,這 11 個又會活回來。補測讓 present.ts 的每個分支有自己直接的斷言。

## 1. 12 個存活逐個判決

來源:T25 驗收的 Stryker 輸出(同一個檔、同一組 `present*.test.ts`),本次補測前重現 12 個、位置完全相同(57:7 ×3、57:16、57:24、63:13、76:11、111:7、111:51、111:75、131:21、132:15)。

| # | 位置 | 變異內容 | 判決 | 理由 | 補的測試(present-acceptance.test.ts) |
|---|---|---|---|---|---|
| 1 | 57:7 | `if (type === 'fill')` → `if (true)` | **缺口** | 一律走 fill 分支:應用題會被當填空題回(type fill、帶 blanks),原測試只量過填空題 | 「應用題(stage 3 只有 apply)」:type apply、題幹是 apply[0]、**沒有** blanks 鍵 |
| 2 | 57:7 | `if (false)` | **缺口** | 一律走 apply 分支:填空題會被當應用題回(沒有 blanks、type apply) | 「填空題」:整個回傳 toEqual,含 type fill、blanks=2、鍵清單 |
| 3 | 57:7 | `type === 'fill'` → `type !== 'fill'` | **缺口** | 兩種題型顛倒 | 同上兩條 |
| 4 | 57:16 | `'fill'` → `""` | **缺口** | 比對字串被換掉,填空題退到 apply 分支 | 「填空題」 |
| 5 | 57:24 | fill 分支的區塊被清空 | **缺口** | 填空題回 undefined / 走到 apply 分支,不回題目 | 「填空題」 |
| 6 | 63:13 | 回傳的 `type: 'fill'` → `type: ""` | **缺口** | 呈現給使用者的題型字樣變空,顯示端(CLI)用它決定提示與輸入方式 | 「填空題」toEqual 釘 type |
| 7 | 76:11 | 回傳的 `type: 'apply'` → `type: ""` | **缺口** | 同上,應用題 | 「應用題」toEqual 釘 type |
| 8 | 111:7 | `if (session.current && …)` → `if (false)` | **缺口** | stage 2 的第二題(同一張卡)會重新載入題目檔、重設 typeIndex 與 pendingAnswers,第一題的作答狀態就丟了、卡在第一題 | 「stage 2 的第二題」:推 typeIndex 後回 apply 題、current 還是同一個物件、換掉磁碟題目檔也不會重新載入 |
| 9 | 111:51 | `session.queue[0]?.card` → `session.queue[0].card` | **缺口** | queue 空了而 current 還留著時,原本回 `done`;變異後丟 TypeError | 「queue 空了、current 還留著 → 回 done(不丟錯)」 |
| 10 | 111:75 | `if` 的區塊被清空 | **缺口** | 同 #8:第二題不會走「已設定」那條 | 「stage 2 的第二題」 |
| 11 | 131:21 | `pendingAnswers: []` → `["Stryker was here"]` | **缺口** | 新題一開始就帶一筆假的待決答案:stage 2 結算時會多算一筆(轉移判斷被污染) | 「第一次呈現時建立的 current」:逐欄 toEqual,pendingAnswers 是空陣列 |
| 12 | 132:15 | `hadError: false` → `true` | **缺口** | 新題一開始就標成批改失敗:這張卡的結果會被當錯誤、整個 checkpoint 不寫轉移 | 同上,hadError 是 false |

另外補了兩條行為釘子(不對應特定存活,但守同一段程式):stuck 旗標在填空與應用都原樣帶出;進度分子 = totalDue − 還在 queue 的張數 + 1(5 題答了 2 題 → 3/5)。

## 2. 完整指令

```bash
# 補測前(把補測檔移開),只靠 present 自己的四個測試檔:
MUTATE_TEST_GLOB 在設定檔的 commandRunner 裡:'packages/core/src/session/present*.test.ts'
npm run mutate -- <stryker 設定檔:mutate = packages/core/src/session/present.ts,testRunner command,
                   command = "MUTATE_TEST_GLOB='…' npx vitest run --bail=1 --config vitest.mutate.config.ts",
                   coverageAnalysis off,concurrency 2>
# 補測後:把 present-acceptance.test.ts 放回去,同一個設定再跑
```

設定檔(驗收用,不進版控):

```json
{
  "packageManager": "npm",
  "testRunner": "command",
  "commandRunner": { "command": "MUTATE_TEST_GLOB='packages/core/src/session/present*.test.ts' npx vitest run --bail=1 --config vitest.mutate.config.ts" },
  "reporters": ["clear-text", "progress-append-only"],
  "coverageAnalysis": "off",
  "concurrency": 2,
  "timeoutMS": 300000,
  "mutate": ["packages/core/src/session/present.ts"],
  "thresholds": { "high": 90, "low": 70, "break": 0 },
  "ignorePatterns": ["reports", "dist", "target", "apps/desktop/src-tauri"]
}
```

第二列(session 全部測試)只把 glob 換成 `packages/core/src/session/**/*.test.ts`。入口一律 `npm run mutate --`(機器範圍的 Stryker 鎖)。
補測檔本身:`npx vitest run packages/core/src/session/present-acceptance.test.ts` → 8 條綠;`npx tsc --noEmit` 0 錯。

## 3. 其他

- 沒有改任何實作檔;沒有 worker;沒有 LLM 花費。
- `git log --name-only` 沒有 mutants.out;`reports/` 是 Stryker 的輸出目錄,已被 .gitignore 擋掉,沒進 git。
- 與最新 main(e80ec80)的 `git merge-tree`:無衝突。
- learning/ 前後(唯一量法,只讀):開跑前沿用 T26 收尾量值 64/6335855d9945ca2b/96;跑完後 64/bc1699974215c435/102——多 6 行帳本,全是 `llm_call`、task 欄 ingest.cards、2026-10-16 18:13–18:14 UTC(台北 02:13),模式與協調者的 golden `--live` 重跑相同(三個輸入 × 兩組)。我這張的所有測試只用暫存目錄與 Stryker 沙箱,沒有指向真目錄;已請協調者確認。

## 4. 結論

12 個存活全是缺口(0 個等價),已補 8 條測試;present.ts 的 Stryker 78.57% → 100.00%(只靠 present 自己的測試)。補測檔建議進 main。
