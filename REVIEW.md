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
  - 新增探針 `[missing] LLM_DAILY_CAP_USD 是空字串(unset 由 llm-spend.test.ts 守)`(審核輪改名,理由見 §7.1)。
- 沒動:`.env`、`.env.example`、`scripts/zero-input-guard.baseline.json`、`scripts/llm-spend.ts`、`scripts/_env.ts`。

---

## 七、審核輪(2026-09-05,同一分支;審核輪可以動測試檔)

### 7.1 覆核上一輪三件,各自的證據

| 要確認的 | 證據 | 結論 |
|---|---|---|
| `SPEND_ENV` 寫死在測試檔 | `scripts/zero-input-guard.test.ts:334`:`const SPEND_ENV: Record<string, string> = { LLM_DAILY_CAP_USD: '1', LLM_PRICE_IN_PER_M: '2.5', LLM_PRICE_OUT_PER_M: '10' };` 是字面量 | ✅ |
| 不讀 `process.env` | 那一行 `grep -c 'process.env'` = 0;整個 llm-spend 區塊(`awk '/label: .llm-spend./,/^      },$/'` 切出來)`grep -c 'process.env'` = 0 | ✅ |
| 不整包 `...process.env` 蓋 | 同上 0 命中;spawn 端是 `env: { ...withoutNodeOptions(process.env), ...inv.env }`(`:1046`),fixture 疊在**上面**,方向是 fixture 蓋 shell,不是 shell 蓋 fixture | ✅ |
| 每支 spawn 都掛上 | llm-spend 區塊 `grep -c 'args: \['` = **8**(2 基線 + 6 探針);`grep -c 'env: \(SPEND_ENV\|{ \.\.\.SPEND_ENV\)'` = **8**;有 `args:` 沒 `env:` 的行 = **0** | ✅ 掛 8、漏 0 |

**破壞驗證(新探針)** —— `scripts/llm-spend.ts` 的 `strictNumberEnv` 有兩個分支會給「cap 缺」exit 2:`raw === undefined`(沒有設定)與 `raw.trim() === ''`(是空的)。兩個各破一次(sed 改成 `return 0`,trap 還原,還原後 `git diff --stat -- scripts/llm-spend.ts` 為空):

| 破壞 | `npx vitest run scripts/zero-input-guard.test.ts -t llm-spend` | `npx vitest run scripts/llm-spend.test.ts -t 沒設` |
|---|---|---|
| (i) `raw === undefined` → `return 0` | **25 passed / 0 failed(綠,沒抓到)** | 3 failed(`LLM_DAILY_CAP_USD 沒設` / `LLM_PRICE_IN_PER_M 沒設` / `LLM_PRICE_OUT_PER_M 沒設`) |
| (ii) `raw.trim() === ''` → `return 0` | **2 failed**:`[missing] LLM_DAILY_CAP_USD 沒有設定:退出碼非 0`、`…:指名有問題的那條路徑`;23 passed | (沒跑,這條不是它守的) |

**發現:探針名字說「沒有設定」,實際踩的是「是空的」分支。** 工單要的破壞是「沒設就 exit 2 改成回 0 → 那條要紅」,照字面做(破壞 i)那條**不紅**。真正 unset 的分支是 `llm-spend.test.ts` 的純函式測試在守(env 用參數傳,不碰 `.env`)。

**為什麼探針不能用真的 unset**:探針的 env 是疊在 `process.env` 上的,把 key 拿掉要傳 `undefined`(Node 實測 `spawnSync(…, {env:{...process.env, LLM_DAILY_CAP_USD: undefined}})` 子行程看到 `undefined`,可行);但在**有 `.env` 的機器**上,`_env.ts` 的 `loadEnvFile` 會把 unset 的變數補回來 → exit 0 → 探針紅。空字串是唯一「不受 `.env` 影響、又必定 exit 2」的形狀(loadEnvFile 不覆蓋已存在的變數,含空字串,§7.2 的 G 量過)。

**處置**:探針改名 `LLM_DAILY_CAP_USD 是空字串(unset 由 llm-spend.test.ts 守)`,註解寫明兩個分支各由誰守、以及為什麼不用 unset。基準檔沒有這條(`grep -c LLM_DAILY_CAP_USD scripts/zero-input-guard.baseline.json` = 0),改名不動基準。

### 7.2 工單沒點名的形狀,直接跑 `npx tsx scripts/llm-spend.ts --day 2026-09-01 --log <一行健康 llm_call>`(shell 無任何 `LLM_*`,`env | grep -c '^LLM_'` = 0;臨時 `.env` 用 `trap 'rm -f .env' EXIT`)

| 形狀 | 實際輸出 | exit |
|---|---|---|
| A 沒 `.env`、沒 export(對照) | `算不出來:環境變數 LLM_DAILY_CAP_USD 沒有設定(在 .env 或 shell 裡設一個非負數字)` | 2 |
| B `.env` 有 `LLM_DAILY_CAP_USD=`(空),另兩個好 | `算不出來:環境變數 LLM_DAILY_CAP_USD 是空的(在 .env 或 shell 裡設一個非負數字)` | 2 |
| C `.env` `LLM_DAILY_CAP_USD=abc` | `算不出來:環境變數 LLM_DAILY_CAP_USD 不是非負數字:"abc"` | 2 |
| D `.env` 只有 `cap=1`,少兩個價格 | `算不出來:環境變數 LLM_PRICE_IN_PER_M 沒有設定(…)` | 2 |
| E `.env` 有 cap 與 OUT,少 IN | `算不出來:環境變數 LLM_PRICE_IN_PER_M 沒有設定(…)` | 2 |
| F `.env` 三個都好(對照) | `今日 OpenAI 花費 $0.0125(1 次呼叫,log: …/log.jsonl,今日條目 1 筆),上限 $1.0000` | 0 |
| G `.env` 三個都好 **+ shell `LLM_DAILY_CAP_USD=`**(探針的形狀) | `算不出來:環境變數 LLM_DAILY_CAP_USD 是空的(…)` | 2 |

- **B vs A:空字串跟沒設定「結果一樣、訊息不一樣」**——同 exit 2、同點名變數,但一個說「是空的」一個說「沒有設定」。應該不一樣:`.env` 裡寫了 `KEY=` 是人打了一半,跟根本沒寫那一行是兩種修法,訊息分開是對的。這也是 7.1 那個探針名字要改的根據。
- **D / E:只點名第一個少的,不是全部。** `buildSpendReport` 三個 `strictNumberEnv` 依序 early-return。使用者少兩個會被退回兩次(修完 IN 再被說 OUT)。這是 `scripts/llm-spend.ts` 的產品行為,不在這張工單範圍(審核輪只動測試檔),**列為建議**:一次列齊三個缺的,一行改動(先收集再回)。要做的話 `llm-spend.test.ts` 的 8 條「點得出變數名」測試都照樣過,可以加一條「少兩個 → 兩個都點名」。
- **G 就是探針的形狀**:`.env` 明明好的,shell 給空字串仍然 exit 2「是空的」——證明 loadEnvFile 不蓋已存在的空字串,探針在有 `.env` 的機器上一樣穩。

Node 22.15.1 `process.loadEnvFile` 直接量:shell `=''` + 檔 `=5` → `""`;shell `=9` + 檔 `=5` → `"9"`;unset + 檔 `=5` → `"5"`;unset + 檔 `=`(空)→ `""`。

**trap 中途失敗會不會刪**(`( trap 'rm -f .env' EXIT; …; <失敗> )`,每次做完 `ls .env`):

| 失敗方式 | `.env` 事後 |
|---|---|
| 正常結束 | removed |
| `exit 1`(指令中途失敗) | removed(subshell exit=1) |
| `kill -TERM $BASHPID` | removed(exit 143) |
| `kill -INT $BASHPID` | removed |
| `kill -KILL`(setsid 隔離跑) | **留著**(SIGKILL 不能 trap,預期) |

結論:除了 SIGKILL / 斷電,trap 都會刪。上一輪的驗證方式站得住。

### 7.3 全鏈(`export TEMPLATE_DIR=/data/python/llm_learning-cards/.claude/worktrees/agent-a551c3d51889a2793/template`,`git merge main` → Already up to date)

| 步驟 | 退出碼 | 耗時 | 備註 |
|---|---|---|---|
| boundaries | 0 | | |
| typecheck | 0 | | |
| lint:docs | 0 | | |
| test | 0 | 169s | 105 檔 / 2776 passed / 0 failed / 138 skipped;先等別的 worktree(lock-orphan)的 Stryker 鎖 30 秒才拿到,預期 |
| accept:standalone | 0 | 20s |  |
| standalone | 0 | 10s |  |
| accept:dry | 0 | 4s | 0 ambiguous(2263 steps:611 undefined、1652 skipped,undefined 是還沒做的 phase,不是本輪的) |
| check:steps | 0 | 0s |  |
| check:gherkin-dup | 0 | 0s |  |
| accept:coverage | 0 | 83s |  |
| check:gates | 0 | 1s | 「守門內容自同步以來未被更動」 |
| check:all | 0 | 341s |  |

