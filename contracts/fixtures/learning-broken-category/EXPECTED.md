# learning-broken-category 的答案卷

lint 對這個目錄應該回報**恰好 3 個問題**,類型都是 `invalid_category`,退出碼 1。
少於 3 = 有地方沒檢查;多於 3 = 誤報(例如把合法的 `security` 也報了)。

這個 fixture 只用「在 Windows 與 macOS 也能 checkout」的名字:不合法的資料夾名只放 `C++`;
`nul`、NFD 的 `가` 這類在其他系統上建不出來的名字,測試在暫存目錄現場建(見 `category-lint.test.ts`)。

| # | 類型 | 位置 | 分類名 | rule |
|---|---|---|---|---|
| 1 | invalid_category | `raw/C++` | `C++` | charset |
| 2 | invalid_category | `cards/security/sec-0001.md`(frontmatter 的 category) | `a.` | trailing-dot |
| 3 | invalid_category | `config/categories.yaml`(第 2 個項目的 id) | `.hidden` | leading-dot |

`rule` 名用 `contracts/fixtures/path-segment-vectors.json` 的 `rule` 欄。
`detail` 必須同時含分類名與 rule 名。

## 刻意不算問題的

- `config/categories.yaml` 的第 1 項 `security`、`cards/security/` 資料夾:合法。
- `cards/security/sec-0001.md` 的 category(`a.`)與它所在的資料夾(`security`)不一致:
  這個一致性不在 T6 範圍,不計。
