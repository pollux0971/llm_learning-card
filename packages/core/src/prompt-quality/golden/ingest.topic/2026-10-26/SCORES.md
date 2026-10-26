# ingest.topic — 2026-10-26 評分表

兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。

| id | 正確嗎 | 是一個概念嗎 |
|---|---|---|
| topic-photosynthesis | 5 | 5 |
| topic-compound-interest | 5 | 4 |
| topic-git-branch | 4 | 5 |

## 備註(技術顧問評分,2026-10-26)

- topic-photosynthesis(5/5):三張分得乾淨(整體功能、光反應、碳反應),用語跟台灣課本一致。第 1、2 張都提到釋放氧氣,但層次不同,不算重複。
- topic-compound-interest(5/4):第 2 張「為什麼時間重要」的 example 沒有數字,又把第 1 張的機制講了一次。topic.md 已寫「examples 給具體案例,不要重複 body 已經講過的話」,是模型沒照做,不是提示詞缺。
- topic-git-branch(4/5):文字都對。第 1 張的 ASCII 圖把 main 畫成上面一層、底下掛著提交,main 沒有指向任何提交,跟這張卡要講的「分支是指標」相反。第 2 張標題是「建立與切換」,body 卻講用途;怎麼建立只出現在 example。
- 結論:不改 topic.md,不跑第 2 輪。之後要改 topic.md 時可以考慮兩點:example 要有數字或指令;圖要跟 body 的說法一致。
