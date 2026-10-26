# T52 實作報告

環境(開工第一步):

```
UNSET
UNSET
ls: cannot access '.env': No such file or directory
```

兩個 key 都是 UNSET。.env 不存在。沒有建立 .env,沒有用任何 provider 金鑰。LLM 真呼叫 0。沒跑變異測試,沒跑 check:all,沒跑 cucumber,沒跑 --live。

## 做了什麼

字數與 example 圍欄只留 01 的 schema。圍欄正則從 parse-card 原樣搬出,一個字沒改(與起點那一行 cmp 相同)。沒有自己定義開閉同一行、未閉合、結束比開始多、example 後面還有字、縮排 4 格以上、開始行前面有字。舊測試沒有出現「兩邊算出不同」的未定義案例,所以沒有選邊。

- packages/core/src/schema/example-fence.ts 第 13 行:EXAMPLE_FENCE_RE,與起點 parse-card 那一行相同。第 19 行 stripExampleFences:body 拿掉圍欄後 trim,examples 每個內容 trim、依出現順序。
- packages/core/src/schema/word-count.ts 第 47 行:countBodyWords = countWords(stripExampleFences(text).body)。countWords 演算法沒改。
- packages/core/src/schema/index.ts 第 1–2 行:export countBodyWords、stripExampleFences。
- packages/core/src/schema/parse-card.ts 第 29 行:parseCardText 改呼叫 stripExampleFences。日期轉換還在。parseCardText、countWords、validateCard 行為不變。
- packages/core/src/lint/validator-min.ts 第 11 行:countBodyWords 從 @core/schema/word-count.js 轉 export,lint/index.ts 的 export * 沒改。第 40–43 行 parseCard:frontmatter 仍是 gray-matter 原樣(不做日期轉換),body 與 examples 用 stripExampleFences。自己的圍欄 regex、CJK、字母數字判斷已刪。檔頭註解改寫。
- packages/core/src/lint/checks.ts 第 15 行:字數改 countWords(parsed.body),不再用 countBodyWords 拿掉第二次。
- packages/core/src/prompt-quality/word-count.ts:countBodyWords 轉 export,不留自己的邏輯。prompt-quality/index.ts 沒改。
- packages/core/src/prompt-quality/structural-checks.ts 第 156 行:normalizeBody 用 stripExampleFences(body).body,自己的圍欄 regex 已刪。
- packages/core/src/ingest/siblings.ts 第 44 行:摘要用 stripExampleFences(body).body。註解裡過時的「T20」說法已拿掉。generate-cards.ts 沒動。
- 刪 packages/ui-shared/src/word-count.ts。packages/ui-shared/src/index.ts 不再 export wordCount。ui-shared 的 example-fence.ts 沒動。
- scripts/boundaries.allow.json:新增 12-prompt-quality → 01-data-layer(第 88–90 行,理由寫 T52 與 ADR-060 第 3 點)。09-lint → 01-data-layer 那條(第 60 行)補上字數與圍欄,沒有加第二條。
- features/09-lint/FEATURE.md 第 41–44 行:「Wave 0 的重複」註明字數與圍欄 T52 起改用 01,最小驗證器的其餘部分仍在 I6 移除。

呼叫端:git grep wordCount 與 word-count 於 *.js *.mjs *.cjs 沒有命中。刪掉的 wordCount 沒有 apps 或其他正式呼叫端。countBodyWords 的簽章沒變(string → number);lint 與 prompt-quality 的 barrel 仍轉出它。ingest/generate-cards.ts 裡私有的 countBodyWords 是 T20 那條路,工單說不動,沒改。

## 跑過的指令與輸出原文

worktree 沒有 node_modules。用 tar 從 /data/python/llm_learning-cards 複製(排除 .vite、.vite-temp、node_modules/node_modules;連同 apps/teach-card/node_modules、apps/test-card/node_modules、packages/ui-shared/node_modules;不用 symlink;沒複製 src-tauri/target)。複製後 node_modules/@learning/core 仍是相對連結,realpath 指到這個 worktree 的 packages/core。node_modules 在 .gitignore,沒有 add。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run features/support/word-count-vectors.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode


 Test Files  1 passed (1)
      Tests  34 passed (34)
   Start at  01:35:05
   Duration  3.60s (transform 1.01s, setup 75ms, import 560ms, tests 2.81s, environment 0ms)
```

工單單元那一列第一次跑,機器上同時有別的 vitest 與 headless chrome,3 條 hud 渲染測試在 5000ms 逾時(不是斷言失敗,也不是這張改的檔)。隔離重跑那 3 個檔 30 條全綠。接著同一條指令再跑一次,全綠。下面是再跑那一次的原文:

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run packages/core/src/schema/ packages/core/src/lint/ packages/core/src/prompt-quality/ packages/core/src/ingest/ packages/ui-shared/src/ features/support/word-count-vectors.test.ts scripts/lint.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode


 Test Files  108 passed (108)
      Tests  2167 passed (2167)
   Start at  02:03:38
   Duration  786.95s (transform 2.81s, setup 1.50s, import 12.48s, tests 759.92s, environment 9ms)
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsc --noEmit
```

沒有輸出,退出碼 0。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run boundaries
```

```
> boundaries
> tsx scripts/check-boundaries.ts

boundaries.owners.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode/scripts/boundaries.owners.json
boundaries.allow.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode/scripts/boundaries.allow.json
gates.config.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode/scripts/gates.config.json
boundaries: 掃描 397 個檔案,允許例外 25 條
涵蓋:納管 455 / 掃描 455 檔(100.0%),未納管目錄:
  (無)
✓ 無違規
gate=boundaries result=PASS scanned=397
```

例外條數 24 → 25(+1)。

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npm run check:json-duplicate-keys
```

```
> check:json-duplicate-keys
> tsx scripts/check-json-duplicate-keys.ts

json-duplicate-keys.scope.json: 設定:/home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode/scripts/json-duplicate-keys.scope.json
✓ 40 個 JSON 設定檔沒有同層重複鍵
gate=json-duplicate-keys result=PASS scanned=40
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx tsx scripts/check-doc-links.ts
```

```
doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, .turbo, .cache, target, .stryker-tmp, __pycache__, .venv, venv, reports, archive, tmp-learning, learning]、排除前綴 [.claude/worktrees, contracts/fixtures]
doc-links: 掃描 303 個 markdown 檔,167 條相對連結

✗ 1 條連結指到不存在的檔案:
  docs/tickets/T52-word-count-single-source-vectors.md:42  →  `../../packages/ui-shared/src/word-count.ts:11`

改了檔名或搬了目錄就要一起改指過去的連結;真的要指到還沒有的檔案就先別寫成連結。
gate=doc-links result=FAIL scanned=167
```

這條是工單自己的反引號路徑參照,指到工單要求刪掉的檔。工單不在 touches,沒改。見待協調。報告寫完後再跑一次,掃描 304 個 markdown 檔,仍是同一條、沒有新增。

```
git grep -n boundaries.allow -- '*.test.ts'
```

```
apps/desktop/src/review-client.test.ts:263:  it('scripts/boundaries.allow.json 有一條 10-desktop-shell → 11-review-cli,理由提到 ADR-075', () => {
apps/desktop/src/review-client.test.ts:264:    const entries = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/boundaries.allow.json'), 'utf8')) as { from: string; to: string; reason: string }[];
apps/test-card/src/no-stubs-static.test.ts:156:  it('scripts/boundaries.allow.json 有 06-test-card → 10-desktop-shell,理由寫 ADR-075', () => {
apps/test-card/src/no-stubs-static.test.ts:157:    const allow = JSON.parse(readFileSync(join(ROOT, 'scripts/boundaries.allow.json'), 'utf8')) as unknown;
apps/test-card/src/session.test.ts:51:// (那條邊是 T24 的實作加進 boundaries.allow.json 的),基底上 npm run boundaries 不因這個檔而紅。
features/support/t31-static.test.ts:7: *   - `scripts/boundaries.allow.json`:05-grading → 03-llm-router 還是**一條**(不加新的),`reason` 補上 grade-apply.ts、grade-fill.ts 與
features/support/t31-static.test.ts:35:const allow = (): AllowEntry[] => JSON.parse(read('scripts/boundaries.allow.json')) as AllowEntry[];
scripts/check-boundaries.test.ts:35:  writeFileSync(join(root, 'scripts', 'boundaries.allow.json'), JSON.stringify(allow, null, 2), 'utf8');
scripts/check-boundaries.test.ts:229:  it('boundaries.allow.json 是壞掉的 JSON → 印「設定檔壞掉」,不是未捕捉的堆疊', () => {
scripts/check-boundaries.test.ts:232:    writeFileSync(join(dir, 'scripts', 'boundaries.allow.json'), '[ not json either', 'utf8');
```

```
CARGO_BUILD_JOBS=2 VITEST_MAX_WORKERS=1 npx vitest run apps/desktop/src/review-client.test.ts apps/test-card/src/no-stubs-static.test.ts apps/test-card/src/session.test.ts features/support/t31-static.test.ts scripts/check-boundaries.test.ts
```

```
 RUN  v4.1.11 /home/pollux/orca/workspaces/llm_learning-cards-workers/t52-opencode

 ❯ features/support/t31-static.test.ts (14 tests | 1 failed) 107ms
     × 整份例外清單條數不變(不加新的一條) 7ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  features/support/t31-static.test.ts > boundaries 例外的理由(驗收 6) > 整份例外清單條數不變(不加新的一條)
AssertionError: expected [ { …(3) }, { …(3) }, { …(3) }, …(22) ] to have a length of 24 but got 25

- Expected
+ Received

- 24
+ 25

 ❯ features/support/t31-static.test.ts:82:21
     80|
     81|   it('整份例外清單條數不變(不加新的一條)', () => {
     82|     expect(allow()).toHaveLength(BASE_ALLOW_ENTRIES);
       |                     ^
     83|   });
     84| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 331 passed (332)
   Start at  02:17:22
   Duration  23.85s (transform 401ms, setup 110ms, import 339ms, tests 22.75s, environment 1ms)
```

其餘 4 個檔全綠。紅的那一條見待協調。測試檔沒改。

## 待協調

1. features/support/t31-static.test.ts 第 28 行 BASE_ALLOW_ENTRIES 釘 24,第 82 行斷言例外清單長度不變。工單要求加一條 12-prompt-quality → 01-data-layer,boundaries 因此是 25 條。該測試檔頭自己寫「別的工單加例外時,在這裡補上來源再改數字」。*.test.ts 受保護,沒改。請協調者把常數改成 25,並補上 T52 那一條的來源。05-grading → 03-llm-router 仍是一條,那組斷言是綠的。

2. check-doc-links 紅 1 條:工單 docs/tickets/T52-word-count-single-source-vectors.md 第 42 行用反引號路徑參照指到 packages/ui-shared/src/word-count.ts 第 11 行。工單要求刪這個檔(D1 = A),刪了之後這條參照指到不存在的檔。工單不在 touches,沒改。請協調者把那一格改成純文字(不要反引號包「路徑:行號」),或改指到還在的檔。這份報告沒有新的反引號路徑行號。

沒有契約未定義寫法要選邊的案例。六個舊向量測試檔沒改,單元層裡它們是綠的。
