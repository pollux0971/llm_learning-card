# T53 實作驗收證據

- 工單:T53(02-ingest-pipeline phase-3:來源規則、增量與 stale)
- 被驗分支:t53-impl,sha 12dc5476b983c4121a038a7b7306036a903d911d(起點 3630935,已含補測三條 a7b7b8c)
- 開跑 tree sha:c881e40f358c8471f866984289fb2c3859732f48(筆電);i9 驗收樹 tree sha:a0c379f2e1d44dd78c859cd70b9841c95bac3d33(= t53-impl 合併 main 2fbd295〔含 t53-red3 逾時修〕,再加驗收用變異設定檔,commit 58b0c47)
- 日期:2026-10-26
- 工作樹:乾淨簽出(detached),沒有 .env
- 狀態:完成。**變異 57.06%,低於 80% 的門檻,結論為有阻擋項,請顧問裁。**

## 測試作者與範圍
對起點改了 5 個檔:packages/core/src/ingest/index.ts(+1)、init.ts(+8,listCategories)、scan.ts(新 482 行)、scripts/ingest.ts、docs/reviews/T53-implementation.md。沒有測試檔、步驟定義、contracts、prompts、schema、scheduler、standalone.json 的改動。通過。
補充:起點含紅測試之後補的 t53-scan-buckets.test.ts(一檔一桶、不需要模型的工作不碰網路、unconfiguredFolders;測試 agent 為了補我上一輪列的「測試沒釘的三點」而加)。這個檔我在紅測試驗收時沒看過,這次是第一次跑它。

## 已做完的(通過)
| 項目 | 結果 |
|---|---|
| t53 五個測試檔 | 48/48 綠(單獨跑) |
| packages/core 全部 | 122 檔 2810 條:2809 綠、1 紅(見下方「那一條紅」) |
| tsc | 乾淨 |
| boundaries | PASS,掃 386 |
| check:steps | PASS |
| cucumber,標籤 @ingest-pipeline and @phase-3 | 8 場景:7 綠、1 undefined(場景 2,留給 T55) |
| cucumber,標籤 @ingest-pipeline and not @phase-3 and not @manual | 29 場景 195 步綠 |
| cucumber,標籤 @prompt-quality and @phase-2 and not @manual and not @live | 22 場景 85 步綠 |
| cucumber,標籤 @i1 and not @manual and not @llm and not @e2e | 78 場景 329 步綠 |

## 那一條紅(不是 worker 的錯)
t53-scan-buckets.test.ts 的「CLI:先 --fake --file 處理一個檔,改 raw,再不帶 --fake 掃描 → 退出碼 0、卡被標 stale」在 packages/core 全套跑時(機器 load 約 19)耗 6.7 秒被判紅。單獨再跑該檔兩次(load 同樣約 19)都 12/12 綠。原因:測試用 spawnSync 同步起兩次 tsx,spawn 的 timeout 設了 120 秒,但 vitest 沒設 testTimeout(預設 5 秒)、這個檔也沒放寬,所以機器忙時被 5 秒逾時判紅。協調者已請測試 agent 補 vi.setConfig 的逾時放寬(分支 t53-red3)。我沒有看到任何指向實作的證據。

## 顧問釘的三條與 CLI 探測(讀碼 + 測試)
- CLI 一開始不探測:scripts/ingest.ts 的掃描 CLI 不先呼叫探測,註解寫明「否則離線、沒有金鑰的只標 stale 會被擋下」;掃描函式自己只在有新檔要生成時才探測(scan.ts 約第 420 行),沒有新檔、只標旗標、被拒絕的情況都不探測。buckets 測試的「離線時只標 stale 的掃描照樣成功、探測 0 次」「拒絕也不探測」「CLI 沒有金鑰也退出碼 0」都綠。
- 一個 raw 檔只落一個桶:內容變了的檔不進 skipped,只進 staleCards;刪掉的檔不進 skipped 與 processed(buckets 前四條綠)。
- unconfiguredFolders:不給分類的掃描列出 raw/ 底下不在設定裡的資料夾(排序後),已設定的與沒檔的分類不列,不處理(buckets 最後兩條綠)。

## 在 i9 跑的(變異、手改壞、standalone、t53 與 core 單元)
- 環境:i9(32 核),獨立 worktree,npm ci,沒有 .env、沒有真 learning/。起訖與環境(meta):開始 2026-10-26 15:16:10 load 0.79 溫度 48 度;單元跑完 15:16:16;packages/core 跑完 15:16:27 load 1.62 溫度 59 度;變異跑完 15:34:52 load 5.28 溫度 65 度。
- t53 五檔 48/48 綠(含 t53-red3 的逾時修);packages/core 全部 122 檔全綠(上面筆電那一條紅,在 i9 與含逾時修的樹上沒有再出現)。
- standalone.json 的 02 那一行:輸出 3 張卡(sec-0001 到 sec-0003)、含期望的 sec-0001、多印一行「新建分類 security(require_raw: true)」,退出碼 0。

## 變異測試(在 i9 跑)
指令:npm run mutate -- stryker.t53-scan.json(Stryker CLI;設定檔在本分支,mutate 範圍是 scan.ts 與 init.ts 的 listCategories,測試 glob 是 t53 五檔)。耗時 18 分 24 秒。
分數:**57.06%**(503 個變異:殺 286、逾時 1、存活 216);scan.ts 57.11%、init.ts 55.56%。**未達 80% 的門檻。**
存活 216 個的分佈(逐條不一一貼,按成因歸類):
- 訊息與記錄文字約 90 個:scan.ts 組出給人看的那一行(第 318–333 行)、記錄警告的文字(第 293、297、300、405–414 行)。測試刻意不釘訊息原文(工單:「步驟定義比對這些欄位,不比對訊息原文」),所以這些變異殺不掉;但其中有一類不是純文字:各個「某桶有東西才加一句」的條件被改成永遠真或永遠假時,因為測試不看訊息,也殺不掉。
- 路徑防衛與例外分支約 60 個:相對路徑檢查(第 97–100 行,一行就 11 個)、分類資料夾本身是連結、解析後路徑在分類外(第 156–157 行)、讀目錄與讀檔的 catch、ENOENT 判斷(第 116、172、206 行)、. 開頭與連結的略過(第 177、185 行)等。這些是防衛性程式,測試只覆蓋了主要路徑。
- 離線拒絕的路徑約 7 個:有新檔要生成但探測失敗時的拒絕(第 420–427 行與第 480 行的 cloudBlocked)。**這是真缺口(中)**:沒有測試驗證「有新檔、離線 → 不叫 LLM、回報被擋、不寫卡」;手改壞 J6 也只被「探測至少一次」那條抓到,不是被離線拒絕的行為抓到。
- 其他約 59 個:空陣列初始值被改成非空(後面會被覆寫,多半等價)、init.ts 的 listCategories 內部(約 18 個,例如檔案不在、不是陣列)、today 選項透傳、topicIgnored 的邊界。
扣掉訊息與記錄文字那約 90 個,分數約 69.5%,仍不到 80%。要到 80% 需要補:路徑防衛與離線拒絕這兩塊的測試,或顧問裁定這些防衛程式與訊息文字可以不算。
變異設定檔把 init.ts 的範圍(第 48–62 行)一起算進去;單看 scan.ts 是 57.11%,結論不變。

## 手改壞(在 i9,對 t53-impl 手改 scan.ts;範圍 t53 五檔 48 條)
| # | 改法 | 結果 |
|---|---|---|
| J1 | 內容變了也不標 stale | 紅 14 |
| J2 | sha 一樣卻標 stale | 紅 19 |
| J3 | 沒有新檔也探測 | 紅 3(buckets) |
| J4 | 刪掉的檔標成 stale 而不是 source_missing | 紅 6 |
| J5 | 「檔案不見」的判斷反過來 | 紅 6 |
| J6 | 忽略探測結果、一律當作在線 | 紅 1(只被「有新檔才探測、至少一次」抓到;離線拒絕的行為本身沒被測試抓到,對應上面的缺口) |
| J7 | 已處理過的檔不放進 skipped(競態分支) | **存活**(這支是並行時同一檔已被處理的防衛分支,測試構造不出) |
7 個:6 紅、1 存活。每次還原,最後 git status 乾淨(只剩未追蹤的變異報告檔,沒有提交)。

## 資料前後(只記數字)
learning/ 檔案數、整體雜湊、帳本行數:前 64 / c2e4dd6d71de3976 / 108,後 64 / c2e4dd6d71de3976 / 108(前後相同)。

## 花費
worker 3.39 美元(協調者給的,只記錄)。工單預算 2 美元,比值約 1.7 倍,沒有超過 2 倍。

## 結論
有阻擋項:變異 57.06%,低於工單要求的 80%。其他所有驗項(diff 範圍、單元、tsc、boundaries、steps、四組 cucumber、CLI 探測、顧問釘的三條、standalone、手改壞)都通過,沒有發現實作行為上的錯誤。建議顧問裁:(a)請測試 agent 補離線拒絕與路徑防衛的測試後重跑變異;或(b)裁定訊息文字與防衛分支不計入、改以其他門檻放行。
