/**
 * I1 那一次真實 ingest 的 25 張卡(category: security),逐字取自
 * `learning/cards/security/sec-0001.md` .. `sec-0025.md`(2026-09-04 的第四次
 * @e2e @llm run,就是 docs/integration/I1-REVIEW.md 驗收的那一批)。
 *
 * 為什麼把資料複製進來而不是讀那個目錄:那是使用者的 learning 目錄,不在 repo 裡,
 * 也會隨著之後的 ingest 改變。批次檢查的基準必須是**凍結**的,否則 golden 比對
 * 會拿不同的輸入互相比。這份 fixture 就是 I1 當下的快照,不要改它——要換基準
 * 就換一份新的、留著舊的。
 *
 * body 已依契約 §2 移除 example 圍欄(圍欄不算在字數裡,也不參與重複率比對)。
 *
 * 校對過的事實(見 I1-REVIEW.md §8):
 *   - 25 張:sec-0001..sec-0025,8 張 level 0、17 張 level 1
 *   - level 0 卡的 prereqs 含 level 1 卡:4 筆
 *     sec-0003→sec-0011、sec-0004→sec-0012、sec-0007→sec-0022、sec-0008→sec-0023
 *     (§8.2 只點名了第一筆,其餘三筆是這個 phase 實際掃出來的)
 *   - 人判定的語意近重複 4 對(§8.1):sec-0007/sec-0015、sec-0006/sec-0016、
 *     sec-0003/sec-0013、sec-0003/sec-0014
 */
import type { BatchCard } from '../types.js';

export const I1_SECURITY_BATCH: BatchCard[] = [
  {
    id: 'sec-0001',
    title: "同源的判定",
    level: 0,
    prereqs: [],
    body: "同源由協定、主機、埠號三部分決定；三者都相同才算同源。",
  },
  {
    id: 'sec-0002',
    title: "同源政策的目的",
    level: 0,
    prereqs: [],
    body: "同源政策限制網頁讀取其他來源的資料，避免網站利用瀏覽器自動附帶的 cookie 攻擊敏感服務。",
  },
  {
    id: 'sec-0003',
    title: "來源變更的影響",
    level: 0,
    prereqs: ['sec-0011'],
    body: "相同主機的不同路徑仍同源；更換協定或埠號後，即使主機相同也不同源。",
  },
  {
    id: 'sec-0004',
    title: "跨來源資源共享",
    level: 0,
    prereqs: ['sec-0012'],
    body: "CORS 讓前端與不同來源的 API 協作。伺服器以回應標頭列出允許的來源，瀏覽器符合後才交付內容。",
  },
  {
    id: 'sec-0005',
    title: "CORS 的授權決定者",
    level: 0,
    prereqs: ['sec-0004'],
    body: "跨來源權限由伺服器決定，發出請求的網頁不能自行宣稱獲得授權。",
  },
  {
    id: 'sec-0006',
    title: "帶憑證的跨來源請求",
    level: 0,
    prereqs: [],
    body: "跨來源請求若帶憑證，伺服器必須明確指定允許來源，不能使用萬用字元。",
  },
  {
    id: 'sec-0007',
    title: "預檢請求",
    level: 0,
    prereqs: ['sec-0022'],
    body: "對可能改變狀態或含自訂標頭的跨來源請求，瀏覽器會先詢問伺服器；獲准後才送出正式請求。",
  },
  {
    id: 'sec-0008',
    title: "預檢結果快取",
    level: 0,
    prereqs: ['sec-0023'],
    body: "預檢結果可快取一段時間，讓後續相同請求免除額外的往返。",
  },
  {
    id: 'sec-0009',
    title: "主機名稱的精確比對",
    level: 1,
    prereqs: ['sec-0001'],
    body: "主機名稱需完全一致；子網域、IP與網域名稱不同也不算同源。",
  },
  {
    id: 'sec-0010',
    title: "預設埠號仍會比較",
    level: 1,
    prereqs: ['sec-0001'],
    body: "網址省略埠號時會採用協定的預設埠號；明寫其他埠號仍會造成不同源。",
  },
  {
    id: 'sec-0011',
    title: "同源的三項判定",
    level: 1,
    prereqs: ['sec-0009', 'sec-0010', 'sec-0002'],
    body: "來源是否相同，取決於協定、主機名稱與連接埠；任一不同，瀏覽器便視為跨源。",
  },
  {
    id: 'sec-0012',
    title: "跨源請求與讀取權",
    level: 1,
    prereqs: ['sec-0003', 'sec-0002'],
    body: "跨源請求不必然被阻擋；同源政策主要限制回應資料被腳本讀取，伺服器仍可能收到請求。",
  },
  {
    id: 'sec-0013',
    title: "協定變更會跨源",
    level: 1,
    prereqs: ['sec-0003'],
    body: "只要協定不同，即使主機與路徑相同，也會被視為不同來源。",
  },
  {
    id: 'sec-0014',
    title: "埠號變更會跨源",
    level: 1,
    prereqs: ['sec-0003'],
    body: "埠號屬於來源的一部分；埠號不同時，兩個網址不再同源。",
  },
  {
    id: 'sec-0015',
    title: "CORS 預檢請求",
    level: 1,
    prereqs: ['sec-0007', 'sec-0004'],
    body: "跨來源請求若使用非簡單方法或自訂標頭，瀏覽器會先發 OPTIONS；伺服器須回覆允許的方法與標頭。",
  },
  {
    id: 'sec-0016',
    title: "攜帶憑證的 CORS",
    level: 1,
    prereqs: ['sec-0006', 'sec-0005', 'sec-0004'],
    body: "請求含 Cookie 或其他憑證時，前端須啟用 credentials；伺服器不可將允許來源設為萬用字元。",
  },
  {
    id: 'sec-0017',
    title: "暴露回應標頭",
    level: 1,
    prereqs: ['sec-0012', 'sec-0004'],
    body: "瀏覽器預設限制前端可讀取的回應標頭；伺服器可用 Expose-Headers 放行自訂標頭。",
  },
  {
    id: 'sec-0018',
    title: "伺服器回應授權來源",
    level: 1,
    prereqs: ['sec-0005'],
    body: "伺服器以 `Access-Control-Allow-Origin` 回應標示允許的來源；缺少或不匹配時，瀏覽器會阻擋網頁讀取回應。",
  },
  {
    id: 'sec-0019',
    title: "憑證請求不能使用萬用來源",
    level: 1,
    prereqs: ['sec-0016', 'sec-0005'],
    body: "含 Cookie 的跨來源請求不能搭配 `*`；伺服器須回傳明確來源，並設定 `Access-Control-Allow-Credentials: true`。",
  },
  {
    id: 'sec-0020',
    title: "回應標頭需回映來源",
    level: 1,
    prereqs: ['sec-0018', 'sec-0006'],
    body: "伺服器應驗證 Origin 後，填入相同值的 Access-Control-Allow-Origin，不可任意回映。",
  },
  {
    id: 'sec-0021',
    title: "允許瀏覽器交付憑證回應",
    level: 1,
    prereqs: ['sec-0016', 'sec-0006'],
    body: "前端使用 credentials 時，回應還需有 Access-Control-Allow-Credentials: true，否則瀏覽器不交付回應。",
  },
  {
    id: 'sec-0022',
    title: "觸發預檢的條件",
    level: 1,
    prereqs: ['sec-0004'],
    body: "使用 PUT、DELETE 等方法，或攜帶自訂標頭、非簡單內容型別時，通常會觸發預檢。",
  },
  {
    id: 'sec-0023',
    title: "OPTIONS 預檢交換",
    level: 1,
    prereqs: ['sec-0015', 'sec-0007'],
    body: "預檢使用 OPTIONS；伺服器須以 CORS 標頭明確列出允許的來源、方法與標頭。",
  },
  {
    id: 'sec-0024',
    title: "設定快取期限",
    level: 1,
    prereqs: ['sec-0008'],
    body: "伺服器用 `Access-Control-Max-Age` 指定秒數；過期後瀏覽器須重新預檢。期限過長會延後政策更新生效。",
  },
  {
    id: 'sec-0025',
    title: "預檢快取鍵",
    level: 1,
    prereqs: ['sec-0008'],
    body: "快取不是只看 URL；來源、HTTP 方法、請求標頭集合與憑證模式不同，可能各自建立預檢結果。",
  },
];
