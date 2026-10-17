/**
 * T31:`scripts/review.ts` 子程序的假網路層——跟 `t30-cloud-401.mjs` 同一種用法(`--import` 載入、換掉 globalThis.fetch、不打真網路),
 * 差別是模擬「模型這次不能用」與「程式的 bug」。用環境變數 `T31_FAKE_MODE` 選:
 *   cloud-429    雲端 chat completions 回 429(限流;SDK 會自己退避重試兩次,最後丟 RateLimitError)
 *   refused      雲端 chat completions 的 fetch 丟 TypeError('fetch failed')、cause ECONNREFUSED(SDK 包成 APIConnectionError)
 *   gateway-503  沒設 provider 時應用題走閘道:換 token 成功、/gateway/models 有模型、/gateway/chat 回 503
 *   bug-body     雲端 chat completions 回 200 但內容是純文字(adapter 讀 choices[0] 時丟 TypeError——程式的 bug 的樣子)
 * `/v1/models`(probeOnline)回 200,讓 router 認為雲端可達、應用題照契約 §7 走雲端。
 */
const MODE = process.env.T31_FAKE_MODE ?? '';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async function fakeDownFetch(input) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/v1/models')) return jsonResponse({ data: [] });
  if (url.includes('/chat/completions')) {
    if (MODE === 'cloud-429') return jsonResponse({ error: { message: 'Rate limit reached', type: 'rate_limit_error' } }, 429);
    if (MODE === 'refused') {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });
    }
    if (MODE === 'bug-body') return new Response('this is not a chat completion', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  if (url.includes('/auth/token/exchange')) return jsonResponse({ access_token: 'fake-token', expires_in: 3600 });
  if (url.includes('/gateway/models')) return jsonResponse({ models: { 'fake-local': {} } });
  if (url.includes('/gateway/chat') && MODE === 'gateway-503') return jsonResponse({ error: 'upstream down' }, 503);
  throw new Error(`t31-cloud-down.mjs 沒有預期到的請求(模式 ${MODE}):${url}`);
};
