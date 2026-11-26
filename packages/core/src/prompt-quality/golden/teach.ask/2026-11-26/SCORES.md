# teach.ask — 2026-11-26 評分表

兩個維度,各 1–5 分:正確嗎、是一個概念嗎。工具不判斷品質,這份表是給人填的。

| id | 正確嗎 | 是一個概念嗎 |
|---|---|---|
| ask-general | 5 | 5 |
| ask-off-topic | 5 | 5 |
| ask-skip-learning | 5 | 5 |
| ask-unlearned-prereq | 5 | 5 |
| ask-deepest-level | 5 | 5 |
| ask-very-short | 5 | 4 |

## 備註(技術顧問評分,2026-11-26)

- 六個輸出都是一個 JSON 物件,只有 answer、suggestion、followups 三個鍵;answer 42–96 字(prompt 上限 200),followups 每組 2 個、每個不超過 30 字。structural 六個都沒有 issue。
- ask-general(5/5):用「已排序」推出「另一半不可能有目標」,兩個方向都講到,正是問題要的。建議 continue 合理。
- ask-off-topic(5/5):沒有回答晚餐,直接說跟這張卡無關,並把話題拉回卡片內容;追問也都回到水循環。建議 continue 合理。
- ask-skip-learning(5/5):沒有照要求直接給答案,改用原卡的猜數字例子給一個提示讓人自己想。這是我們要的行為。
- ask-unlearned-prereq(5/5):先用兩個數列解釋「排好順序」,再點出先備是「排序」、建議先補;suggestion=back,跟輸入的未學先備一致。
- ask-deepest-level(5/5):正確說出已是最深一層,沒有編出更深的內容;建議 continue 而不是 deepen,對。小缺點:「你已掌握…」是替使用者下結論,但不算錯。
- ask-very-short(5/4):對只有「為什麼?」的問題,挑了卡片的核心(每次砍半)來解釋,內容正確,1000 筆約 10 次也跟原卡一致。扣一分:帶進了原卡沒有的 log₂(n),對 level 1 的讀者多了一個新概念;建議 deepen 可以接受(問題太短、看不出卡在哪)。
- 共同的觀察:followups 六組都剛好 2 個,沒有出現 0 個或 3 個;不是錯,之後如果想讓追問更有變化可以在 prompt 加一句,現在不改。
- 結論:不改 `packages/core/prompts/teach/ask.md`,不跑第 2 輪。之後要改 prompt 時可考慮兩點:回答盡量只用卡片裡已有的概念;不要替使用者判斷「你已經懂了」。
