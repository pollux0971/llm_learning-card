# fixtures/ — 真的測試資料

不是規範,是可以直接讀取的檔案。每個功能單獨跑的時候吃這裡的東西,
所以整合時大家對「sec-0001 是什麼」的理解一致。

## 清單

```
learning-minimal/     一個合法的最小 learning/,3 張卡、1 個類別。lint 應該回報 0 個問題
learning-broken/      刻意壞掉的,附 EXPECTED.md 列出每一個問題
path-segment-vectors.json   路徑段向量(契約 §13、§1 CategoryId),TS 與 Rust 共用
vault-pointer-vectors.json  使用者層指標檔與帳本身分標記的向量(契約 §12),TS(T5)與 Rust(桌面程式)共用;47 列:路徑 3、標記比對 19、指標內容 11、解析狀態 14
word-count-vectors.json     教學卡 body 字數與 example 圍欄的向量(契約 §2 1.5.0、ADR-060、ADR-081、T52、T57);170 列,全 ASCII(非 ASCII 用 \u 跳脫)、每列有 covers 與 basis(選填 strippedBody:移除圍欄後的 body 原文,逐位元組比);每一份讀 §2 規則的實作都要跑每一列(features/support/word-count-vectors.test.ts)
learning-broken-category/  不合法的分類名(契約 1.4.0 §1),附 EXPECTED.md;lint 應回報恰好 3 個 invalid_category
cards/                單張卡的合法與非法樣本,檔名說明錯在哪
reviews/              各種複習狀態
weekly/               週目標狀態
llm/                  預錄的模型回應,給 FakeLlmRouter 重播
raw/                  原始素材樣本
```

## 規則

- fixture 是硬約定的一部分。**加新的隨時可以;改既有的要 ADR**,因為別人的測試靠它
- 每個 invalid fixture 的檔名要說明錯在哪
- `learning-broken/EXPECTED.md` 是 lint 的答案卷:每個問題一行。lint 找到的數量必須相符
- `llm/` 的檔名格式 `<task>.<情境>.json`,讓重播可以確定性地選檔

## 還缺的

這裡是最小可用的一套。以下等你手上有真資料時再補,不必現在造:

- `learning-rich/` — 3 類別 30 張卡,含 level 0–2 與各種標記。**建議做法:I1 通過後,
  拿你真的餵進去的東西挑一份出來當 fixture**,比人造的好用
- 更多 `llm/` 重播 — 同上,I1 之後把真的回應存下來
