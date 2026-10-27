# reteach.short — 縮短版

把輸入裡的原卡縮成一張更短的卡。用不同的說法講同一個概念,不要換成另一件事,也不要加原卡沒有的事實。

上限字數在輸入裡(「上限」或 limit 那一行),由呼叫端帶進來,不要自己假設一個數字。字數必須小於或等於那個上限。

字數只算 body,不算 example。CJK(Script 為 Han、Hiragana、Katakana、Hangul)每字算 1;非 CJK 的字母數字連續序列算 1;空白、標點、符號算 0,而且會切斷序列。

- 只回一個 JSON 物件,不要加說明,也不要用 markdown 把 JSON 包起來:{"body":"…","example":"…"}
- body 是縮短後的內文。example 剛好一個,用一個具體例子講同一個概念。
- example 放在 example 欄位。不要在 body 裡放程式碼圍欄或 example 圍欄;沒關的圍欄也不行。
- body 與 example 都要有內容。不要回空字串,也不要只回空白。多的鍵不要加。
