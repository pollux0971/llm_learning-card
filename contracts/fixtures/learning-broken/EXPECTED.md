# learning-broken 的答案卷

lint 對這個目錄應該回報**恰好 10 個問題**,退出碼 1。
少於 10 = 有檢查沒實作;多於 10 = 有檢查太嚴,誤報。

| # | 類型 | 位置 | 問題 |
|---|---|---|---|
| 1 | body_over_limit | `cards/security/sec-0001.md` | body 超過 100 字 |
| 2 | missing_questions | `cards/security/sec-0002.md` | 沒有對應的考題檔 |
| 3 | missing_questions | `cards/security/sec-0003.md` | 沒有對應的考題檔 |
| 4 | missing_questions | `cards/security/sec-0004.md` | 沒有對應的考題檔 |
| 5 | missing_prereq | `cards/security/sec-0003.md` | prereqs 指向不存在的 sec-9999 |
| 6 | orphan_child | `cards/security/sec-0010.md` | parent sec-0040 不存在 |
| 7 | missing_questions | `cards/security/sec-0010.md` | 沒有對應的考題檔 |
| 8 | orphan_questions | `questions/sec-8888.yaml` | 沒有對應的卡片 |
| 9 | cycle | `graph/deps.json` | sec-0001 → sec-0002 → sec-0003 → sec-0004 → sec-0001 |
| 10 | review_orphan | `state/reviews.json` | sec-7777 不存在 |

## 發現記錄

這份答案卷原本寫「恰好 9 個問題」,但漏算了 `sec-0004` 也沒有考題檔
(`missing_questions`)。09-lint/phase-1 實作時發現了這個落差,把這裡改成 10。
這證明 lint 是照 fixture 的真實內容數問題,不是照這份文件湊數字。

## 刻意不算問題的

- `sec-0004` 的 `stale: true` — 這是一個狀態不是問題,lint 列在「狀態」區塊而不是「問題」區塊,不計入退出碼、不計入上表
- 迴圈(#9)上的四張卡(`sec-0001`~`sec-0004`)的 `prereqs` 跟 `graph/deps.json` 的 edges
  互相矛盾,但這個矛盾**就是**迴圈本身造成的——lint 對迴圈成員不重複跑
  「prereqs 與 graph 不一致」檢查,避免同一個根因報兩次。這個檢查在
  `phase-1.feature`「A disagreement between prereqs and the graph is found」
  場景裡用一組乾淨、不在迴圈上的卡片單獨驗證。
