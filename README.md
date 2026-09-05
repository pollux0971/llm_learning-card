# 桌面學習卡片系統

兩張常駐桌面的小卡片:**教學卡**每次教一個 100 字內的概念,**考試卡**用 1 / 7 / 30 / 90 / 180 天的固定骨架考你。
這個 repo 是它的**規格與開發骨架**,不含實作程式碼。

## 五個組織原則

1. **契約先定案。** `contracts/` 定義所有跨模組的型別與檔案格式,附**真的 fixture 檔案**。
   磁碟格式改動要走 ADR;記憶體介面改了跑測試就好。
2. **每個功能單獨可跑。** 指令在 `standalone.json`,驗收時會實際執行。
3. **每次整合都是完整可用的系統。** I2 之後你就能每天用終端機複習,I4 之後是完整的兩張卡。
4. **沒有 gherkin 不開工。** 規格即測試。
5. **測試要被測試。** mutation testing 驗證測試真的有在測東西——但只有排程與審核那幾個模組是硬門檻。

**覺得太重就縮。** `docs/03-agile-workflow.md` 有「最小模式」,說明只保留核心怎麼跑。

## 目錄

```
.
├── CLAUDE.md                     給 Claude Code 的專案規則
├── standalone.json               ★ 每個功能的單獨執行指令。驗收時實際跑它
├── contracts/                    ★ 跨模組約定 + 真的測試資料
│   ├── README.md                 硬約定 / 軟約定的分層與變更流程
│   ├── types.md                  型別與檔案格式的權威定義
│   └── fixtures/                 ★ 可直接使用的檔案,不是規範
│       ├── learning-minimal/     3 張真的資安卡、考題、依賴圖。lint 應回報 0 問題
│       ├── learning-broken/      刻意壞掉的,附 EXPECTED.md 答案卷
│       ├── cards/                單張卡的合法與非法樣本,含字數邊界案例
│       ├── reviews/              各種複習狀態,附排序預期
│       ├── weekly/               含 ISO 年末交界
│       ├── raw/                  原始素材
│       └── llm/                  預錄回應,給 FakeLlmRouter 重播
├── docs/
│   ├── 00-design.md              設計文件 v1(歷史)
│   ├── 01-roadmap.md             Wave 0 + I1–I8,與 gherkin 雙向對照
│   ├── 02-decision-map.md        25 筆 ADR + 依賴圖
│   ├── 03-agile-workflow.md      wave / gate / sprint 怎麼跑
│   ├── 04-glossary.md            術語
│   ├── 05-parallel-and-integration.md  為什麼能平行、怎麼整合
│   ├── integration/              ★ 分階段整合的 Gherkin
│   │   ├── README.md
│   │   └── i1…i8-*.feature       每個整合點一個檔,每個都是可用系統
│   └── sprints/
├── features/
│   ├── README.md                 功能索引與 Gherkin 慣例
│   ├── _template/                新資料夾範本(含 NEXT.md)
│   ├── steps/                    ★ 含 _world.ts 與範例步驟,照那個結構寫
│   └── NN-name/
│       ├── FEATURE.md            範圍、依賴、技術棧、standalone 跑法、phase 表
│       ├── NEXT.md               ★ 指揮 AI:下一個 phase 何時可以開始
│       └── phase-N.feature       英文 Gherkin
└── .claude/skills/               六個 skill,可 /名稱 手動叫也會自動觸發
    ├── feature-triage/           新需求分流
    ├── phase-acceptance/         phase 驗收
    ├── decision-record/          決策記錄(做了取捨就會觸發)
    ├── sprint-planning/          規劃下一步
    ├── integration-check/        整合驗收
    └── mutation-testing/         變異測試的時機、門檻、判讀
```

## 怎麼開始

```bash
git init && npm install
```

用 Claude Code 開啟這個資料夾,然後:

1. 讀 `contracts/README.md`,確認契約你同意。**這是唯一需要在開工前定案的東西。**
2. `/sprint` — 它會挑出 Wave 0 的 phase-1。十個都是 ready,可以同時開,也可以一次做一個。
3. 每做完一個:`/mutate <folder>` 檢查測試品質 → `/phase-done <folder>/phase-1`。
4. Wave 0 全部 done 之後:`/integrate I1`。
5. 開發中想加功能:`/feature <描述>`。做了取捨:`/decide <描述>`。

### clone 完不會自動有的三樣東西(版控外)

`git clone` / `git worktree add` 都不會帶這三樣,每個簽出都要自己做一次:

1. **`.env`**:`LLM_DAILY_CAP_USD`、`LLM_PRICE_IN_PER_M`、`LLM_PRICE_OUT_PER_M`
   (照 `.env.example`)。驗證:`npx tsx scripts/llm-spend.ts --today` 要回 0 或 1,回 2 就是沒設好。
2. **`TEMPLATE_DIR`**:`npm run check:gates` 要用它找模板的 `sync-gates.sh`;沒設就用預設的模板 worktree 路徑。
3. **pre-commit hook**(`scripts/hooks/pre-commit`,模板 v1.4.1 起隨 sync 同步進來;變異測試或全套測試
   持有 `.stryker.lock` 時拒絕 commit)。hook 不進版控,要手動裝:

   ```bash
   cp scripts/hooks/pre-commit "$(git rev-parse --git-path hooks)/pre-commit" && chmod +x "$(git rev-parse --git-path hooks)/pre-commit"
   ```

   用 `git rev-parse --git-path hooks` 而不是寫死 `.git/hooks/`:在 worktree 裡 `.git` 是一個檔案,
   hooks 目錄在主簽出的 `.git/hooks/`,所有 worktree 共用同一份。

## Gherkin 用英文

`# language: en`(cucumber 預設),關鍵字 Feature / Background / Scenario / Scenario Outline / Examples / Given / When / Then / And / But。
中文只出現在 `docs/`、`FEATURE.md`、`NEXT.md`、commands 裡。

## 已知的刻意留白

- `learning-rich/` fixture 沒做。**I1 通過後從你真的餵進去的資料挑一份出來**,比人造的好用
- API key 在桌面 app 怎麼存(keychain)沒有 spec,I3 之後要處理
- CI 沒設。一個人可選,但 `@llm` 場景要跳過的規則已經寫好了
- 磁碟滿、寫入失敗的處理:v1 不做,原子寫入已經涵蓋最重要的情況
