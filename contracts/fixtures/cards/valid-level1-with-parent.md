---
id: sec-0022
category: security
title: 憑證與跨來源
level: 1
parent: sec-0002
source: llm
created: 2026-09-01
prereqs: [sec-0002]
---
帶憑證的跨來源請求規則更嚴。伺服器必須指名允許的來源,不能用萬用字元,而且要另外表明接受憑證。

```example
兩個條件缺一不可:指名來源、明確接受憑證。
```
