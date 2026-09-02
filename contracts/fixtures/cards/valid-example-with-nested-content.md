---
id: sec-0023
category: security
title: 內容安全政策的巢狀範例
level: 0
source: llm
created: 2026-09-01
provisional: true
---
這張卡示範 example 圍欄裡可以放巢狀 markdown,包含清單、粗體與程式碼區塊。

````example
允許的來源可以用清單列出:

- **script-src**:限制腳本來源
- **style-src**:限制樣式來源

設定範例:

```ts
const csp = "script-src 'self'";
```
````
