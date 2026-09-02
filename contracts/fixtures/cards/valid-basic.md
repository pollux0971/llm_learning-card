---
id: sec-0001
category: security
title: 同源政策
level: 0
source: raw
source_ref: raw/security/web-basics.md#L3-L16
created: 2026-09-01
prereqs: []
---
瀏覽器限制網頁只能存取同源資源。同源指協定、主機、埠號三者完全相同。這是防止惡意網站讀取你在其他站台資料的第一道牆。

```example
同源:

- `https://a.com/page` 與 `https://a.com/api`

不同源:

- `https://a.com` 與 `http://a.com`(協定不同)
- `https://a.com` 與 `https://a.com:8443`(埠號不同)
- `https://a.com` 與 `https://b.a.com`(主機不同)
```
