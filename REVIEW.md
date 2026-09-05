# zero-input-guard 的 llm-spend 探針不再依賴 gitignored 的 `.env` — 交接(2026-09-05)

> 舊的 REVIEW.md(template 1.4.1→1.4.3 交接)已隨那張工單併進 main,原文在 `a68a1b0` 的 `REVIEW.md`;本檔整個換成這張工單的交接。

分支 `pollux0971/env-probe`,基底 `a68a1b0`(= main,`git merge main` 回 Already up to date)。只動一個檔:`scripts/zero-input-guard.test.ts`。沒碰 `.env`、`.env.example`、任何版控設定檔、基準檔。

## 一、結論先講

- **乾淨簽出(沒有 `.env`、shell 沒 export 三個 LLM_*)跑 `npx vitest run scripts/zero-input-guard.test.ts`:全綠 583/0**(修前 12 紅)。
- 修法照顧問方向:探針 spawn 時自己注入**寫死在測試檔裡**的 `SPEND_ENV = { LLM_DAILY_CAP_USD: '1', LLM_PRICE_IN_PER_M: '2.5', LLM_PRICE_OUT_PER_M: '10' }`,掛在 llm-spend 兩條基線與每一支探針的 `env:` 上。不讀 `process.env`、不整包蓋。跟既有的 `GIT_IDENTITY` 同型。
- 反向驗證:把 `SPEND_ENV` 改成 `{}` → **同樣那 12 條紅,一條不多不少**;改回來 → 綠。注入就是那 12 條轉綠的原因。
- 順帶檢查:**查過,只有 `llm-spend` 這一支**依賴 gitignored 檔案(依據見 §五)。
- 多加一支探針 `[missing] LLM_DAILY_CAP_USD 沒有設定`(cap 給空字串、log 健康):要 exit 2、不噴 stack、跟 healthy 不同、輸出點名 `LLM_DAILY_CAP_USD`。把「乾淨簽出時基線壞掉的那條訊息」變成受守護的行為。4 條全綠,基準檔零變動。不要的話刪那 6 行即可,其餘不受影響。

## 二、工單沒預料到、需要協調者知道的事

1. **顧問那句「shell export 了也傳不進探針」在我這裡重現不出來。** 探針的 spawn 是 `env: { ...withoutNodeOptions(process.env), ...inv.env }`,`run-tests.ts` 的 `spawnVitest` 也沒給 `env`(繼承)。實測(修之前的檔,乾淨簽出):
   - `export LLM_DAILY_CAP_USD=1 LLM_PRICE_IN_PER_M=2.5 LLM_PRICE_OUT_PER_M=10; npx vitest run scripts/zero-input-guard.test.ts` → 579/0 綠
   - 同樣 export 後 `npm test -- scripts/zero-input-guard.test.ts` → 579/0 綠
   
   所以「export 一下就好」在這條路上**其實有效**;顧問撞到的可能是別的路(不同 shell / 沒 `export` 只 `set` / 經 hook 改寫的指令)。**但這不改變結論**:測試不該靠外部環境,修法一樣。只是 PITFALLS 若要記那句,措辭建議改成「不要靠 export,探針自己注入」,不要寫成「export 無效」。
2. **`process.loadEnvFile` 不會覆蓋已存在的變數,連空字串都不蓋**(node 實測:`FOO=fromshell BAR= node -e "loadEnvFile(...)"` → `FOO=fromshell BAR=[]`)。這是注入具有決定性的根據:使用者 `.env` 填別的值也蓋不掉 `SPEND_ENV`。§四第 2 條用一個 cap=0、價格是垃圾的臨時 `.env` 驗過。
3. 這個 worktree **本來就沒有 `.env`**(`git status --ignored` 只有 `node_modules/`),所以「`mv .env .env.bak`」在這裡等於什麼都不做;工單的驗收狀態就是我的起點狀態。臨時 `.env` 是我自己建、同一指令串用 `trap` 刪掉的,做完 `ls .env` → removed。

## 三、修之前那 12 條紅(完整清單,乾淨簽出、沒 export)

根因一條訊息:

```
基線 healthy:exit=2
--- output ---
算不出來:環境變數 LLM_DAILY_CAP_USD 沒有設定(在 .env 或 shell 裡設一個非負數字)
--------------
```

12 條(每條的斷言訊息都是上面那段,或「空的跟健康的長一樣」兩邊都是上面那段):

- [empty] log.jsonl 是空檔:正當的 exit 0(剛 init 的 vault 就是空的 log,還沒花過錢是事實。訊息帶「0 次呼叫」,跟有花費的那天分得出來)
- [empty] log.jsonl 是空檔:輸出跟基線 healthy 不可以長一樣
- [malformed] log.jsonl 每一行都是壞 JSON:輸出跟基線 healthy 不可以長一樣
- [malformed] log.jsonl 每一行都是壞 JSON:輸出跟基線 quiet 不可以長一樣
- [missing] --log 不存在:指名有問題的那條路徑
- [missing] --log 不存在:輸出跟基線 healthy 不可以長一樣
- [wrong-type] log.jsonl 是一個 JSON 陣列:輸出跟基線 healthy 不可以長一樣
- [wrong-type] log.jsonl 是一個 JSON 陣列:輸出跟基線 quiet 不可以長一樣
- [wrong-type] log.jsonl 每一行都是數字:輸出跟基線 healthy 不可以長一樣
- [wrong-type] log.jsonl 每一行都是數字:輸出跟基線 quiet 不可以長一樣
- 基線 healthy:exit 0、沒有裸錯誤(基線本身壞了,底下的比較就沒有意義)
- 基線 quiet:exit 0、沒有裸錯誤(基線本身壞了,底下的比較就沒有意義)

## 四、驗收與反向驗證的實際輸出

1. **乾淨簽出、沒 export、修後**:
   ```
   Test Files  1 passed (1)
        Tests  583 passed | 138 skipped (721)
   ```
   llm-spend 區塊 25 條 ✓(2 基線 + 6 探針 × 各自的類別),用 `-t llm-spend --reporter=verbose` 逐條看過。
2. **臨時衝突 `.env`**(`LLM_DAILY_CAP_USD=0`、`LLM_PRICE_IN_PER_M=abc`、`LLM_PRICE_OUT_PER_M=`),`trap 'rm -f .env' EXIT`:
   ```
   Test Files  1 passed (1)
        Tests  583 passed | 138 skipped (721)
   .env after: removed
   ```
3. **反向:`SPEND_ENV` 改成 `{}`,沒 `.env`**:
   ```
   Test Files  1 failed (1)
        Tests  12 failed | 571 passed | 138 skipped (721)
   ```
   12 條 FAIL 的標題跟 §三逐字相同。新探針在這個狀態仍綠(它本來就不靠那三個值),所以是 12 不是 16。改回原值再跑 → 583/0。
4. `npx tsc --noEmit` exit 0。

## 五、順帶檢查:其他探針有沒有同型依賴

依據兩層:

- **實證**:乾淨簽出(無 `.env`、無 export、`git status --ignored` 只有 `node_modules/`)整檔只紅那 12 條,全在 llm-spend。其他入口在沒有任何 gitignored 檔的狀態下已經綠。
- **結構**:會載 `.env` 的只有 `import './_env.js'` 的四支(`ingest.ts`、`llm-spend.ts`、`review.ts`、`snapshot.ts`)加自己 loadEnvFile 的 `llm.ts`。`grep` 非測試碼的 `process.env.`:只有 `GATES_CONFIG_DIR`、`PHASE_STATUS_RUN_CMD`、`DEGRADED_WITNESS_DIR`、`KNOWN_DEFECTS_ENUMERATE_CMD`(探針自己傳)與 llm-spend 的三個 `strictNumberEnv`。`packages/*/src` 非測試碼 0 命中。ingest 走 `--fake`、review 走 `--dry-run`、snapshot 帶 `GIT_IDENTITY`,都不碰 LLM_*;`llm.ts` 的探針只探參數層、預期非 0,不需要變數。

**結論:只有 `llm-spend` 這一支。**

## 六、改了什麼(`git diff` 一眼看完)

- `scripts/zero-input-guard.test.ts`
  - `SPEND_DAY` 底下新增 `SPEND_ENV` 常數 + 註解(為什麼寫死、為什麼只注入三個、loadEnvFile 不覆蓋的決定性)。
  - llm-spend 的 `baselines.healthy / quiet` 與 5 支既有探針各加 `env: SPEND_ENV`。
  - 新增探針 `[missing] LLM_DAILY_CAP_USD 沒有設定`。
- 沒動:`.env`、`.env.example`、`scripts/zero-input-guard.baseline.json`、`scripts/llm-spend.ts`、`scripts/_env.ts`。
