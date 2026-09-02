# learning-broken 的答案卷

lint 對這個目錄應該回報**恰好 9 個問題**,退出碼 1。
少於 9 = 有檢查沒實作;多於 9 = 有檢查太嚴,誤報。

| # | 類型 | 位置 | 問題 |
|---|---|---|---|
| 1 | body_over_limit | `cards/security/sec-0001.md` | body 超過 100 字 |
| 2 | missing_questions | `cards/security/sec-0002.md` | 沒有對應的考題檔 |
| 3 | missing_questions | `cards/security/sec-0003.md` | 沒有對應的考題檔 |
| 4 | missing_prereq | `cards/security/sec-0003.md` | prereqs 指向不存在的 sec-9999 |
| 5 | orphan_child | `cards/security/sec-0010.md` | parent sec-0040 不存在 |
| 6 | missing_questions | `cards/security/sec-0010.md` | 沒有對應的考題檔 |
| 7 | orphan_questions | `questions/sec-8888.yaml` | 沒有對應的卡片 |
| 8 | cycle | `graph/deps.json` | sec-0001 → sec-0002 → sec-0003 → sec-0004 → sec-0001 |
| 9 | review_orphan | `state/reviews.json` | sec-7777 不存在 |

## 刻意不算問題的

以下在這個 fixture 裡存在,但**不該**被回報:

- `sec-0004` 的 `stale: true` — 這是一個狀態不是問題,lint 應該列在「狀態」區塊而不是「問題」區塊,不計入退出碼
- `sec-0004` 有考題檔缺失?沒有,它也缺——**等等**,見下方修正

## 已知的自我矛盾(留給你發現)

`sec-0004` 也沒有考題檔,所以嚴格說是 10 個問題不是 9 個。

這一行是刻意留著的:**第一個發現它的人(你或 AI)就證明了 lint 真的在數東西,
而不是照著這份 EXPECTED.md 湊數字。** 發現之後把上表補成 10 個並刪掉這一段。

如果做到 09-lint/phase-1 驗收時沒有人發現,那代表測試是照答案寫的,不是照行為寫的。
