# ingest.cards — 字數超過上限時的重寫

上一次產生的這張卡 body 超過 100 字上限。用一樣的規則(見 cards.md)重寫一次,
把同一個概念講得更精簡:

- 不要改變 title,不要引入新概念,只精簡表達
- 回傳格式跟 ingest.cards 一樣,但只回傳這一張卡的 JSON 陣列(單一元素)
- 只回傳 JSON,不要加任何說明文字或 markdown 圍欄
