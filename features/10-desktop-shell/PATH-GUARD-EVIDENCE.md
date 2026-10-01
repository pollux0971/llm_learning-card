# 10 · desktop-shell — 路徑防護的實測證據

這是規格證據,不是守門設定。`phase-2.feature` 的 Examples 以這張表為準。

## 來源

前端工程師在 main `e3bf2d9` 對兩份 Wave 0 的 `MemoryFs` guard 跑探針:

- `apps/test-card/src/stubs/memory-fs.ts` 的 `guard`(下表 T)
- `apps/teach-card/src/stubs/memory-fs.ts` 的 `assertSafeRelPath`(下表 K)

探針與原始輸出在 `evidence/`(複製前後 sha256 逐位元相同):

```
4deab96603cefee8cdb2604fbe10481a27d717d8aae9318e1dc10ec9a6750b3d  evidence/probe.mts
79f4ec54e85d52893b19e78bc585e24998069cce2420d13ef869b5e777fae97a  evidence/guard-probe-output.tsv
```

輸出是 26 個輸入 × 2 份 guard = 52 行。

## 結論

**16 個輸入,兩份 guard 全部放行。其中 14 個應該拒絕;另 2 個(#15、#16)稍早裁為「正規化後允許」,後來因白名單結構改為拒絕,所以 1.3.0 之後 16 個全部應拒絕。**
14 個應拒絕的輸入全部被放行;其中 2 個(`~/secret`、`" ../x"`)是 2026-10-01 的裁決才加進
「應拒絕」的範圍。

規則(契約 §13 1.3.0,軟約定):**邊界不轉換**。白名單檢查,被檢查的字串與被使用的字串逐位元相同;
不符合的一律拒絕,包含冗餘寫法。(此檔最初記的是稍早的「先正規化再檢查」版本,已被取代。)

## 16 列

字串以 JSON 格式寫(雙引號是邊界,`\\` 是一個反斜線)。

| # | 輸入 | T 實際存成 | K 實際存成 | 應有 |
|---|---|---|---|---|
| 1 | `"..%2f..%2fetc%2fpasswd"` | 原樣 | 原樣 | 拒絕 |
| 2 | `"..%2F..%2Fetc%2Fpasswd"` | 原樣 | 原樣 | 拒絕 |
| 3 | `"%2e%2e/%2e%2e/etc/passwd"` | 原樣 | 原樣 | 拒絕 |
| 4 | `"..%252f..%252fetc"` | 原樣 | 原樣 | 拒絕 |
| 5 | `"..\\..\\etc\\passwd"` | `../../etc/passwd` | 原樣 | 拒絕 |
| 6 | `"cards\\..\\..\\secret"` | `cards/../../secret` | 原樣 | 拒絕 |
| 7 | `"\\etc\\passwd"` | `/etc/passwd` | 原樣 | 拒絕 |
| 8 | `"\\\\server\\share\\x"` | `//server/share/x` | 原樣 | 拒絕 |
| 9 | `"C:\\Windows\\win.ini"` | `C:/Windows/win.ini` | 原樣 | 拒絕 |
| 10 | `"C:/Windows/win.ini"` | 原樣 | 原樣 | 拒絕 |
| 11 | `"file:///etc/passwd"` | 原樣 | 原樣 | 拒絕 |
| 12 | `"~/secret"` | 原樣 | 原樣 | 拒絕(2026-10-01 裁決) |
| 13 | `"cards/a.md\u0000.png"` | 原樣 | 原樣 | 拒絕 |
| 14 | `" ../x"`(開頭一個空白) | 原樣 | 原樣 | 拒絕(2026-10-01 裁決) |
| 15 | `"./cards/a.md"` | 原樣 | 原樣 | 拒絕(契約 §13 1.3.0:邊界不轉換;推翻稍早的「正規化後允許」) |
| 16 | `"cards//a.md"` | 原樣 | 原樣 | 拒絕(同上) |

T 那一欄的 5–9 列顯示**檢查的字串和使用的字串不是同一個**:先檢查 `..`、再把 `\` 換成 `/`,
所以 `..\..\etc\passwd` 通過檢查、存進去變成 `../../etc/passwd`。

## 同一次跑的對照

- 兩份都拒絕、也應該拒絕:`"../../etc/passwd"`、`"cards/../../../etc/passwd"`、`"/etc/passwd"`、
  `"cards/./../../secret"`、`"//etc/passwd"`、`".."`
- 兩份都拒絕、照 §13 是刻意的:`"cards/../state/reviews.json"`(§13 寫「含 `..` 必須拒絕」,系統裡沒有需要走回頭路的正當用途)
- 兩份都允許、也應該允許:`"cards/security/sec-0042.md"`、`"state/reviews.json"`、`"assets/sec-0042-diagram.png"`

## 在 .feature 裡怎麼寫這些字串

Gherkin 表格的格子會去掉頭尾空白、把反斜線當轉義字元,NUL 也放不進檔案。所以 `phase-2.feature`:

- 路徑欄用 JSON 字串(含引號),步驟定義用 `JSON.parse` 還原;格子裡一個真反斜線寫成**四個**反斜線
  (Gherkin 把每兩個變一個,`JSON.parse` 再把剩下兩個變一個)。已用 `@cucumber/gherkin` 的 parser 解出每個格子,再 `JSON.parse`,逐列比對過。
- NUL 那一列用文字描述成獨立 Scenario,不放在表格裡。
