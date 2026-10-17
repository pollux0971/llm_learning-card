/**
 * T30:`scripts/review.ts` 子程序的假網路層——跟 `features/steps/_fake-review-cloud.mjs` 一樣用 `--import` 載入,
 * 差別是雲端的 chat completions 一律回 401(金鑰被拒),模擬「金鑰過期或打錯」。不打真網路。
 * `/v1/models`(probeOnline)回 200,讓 router 認為雲端可達、應用題照契約 §7 走雲端、直接吃到 401。
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async function fake401Fetch(input) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/v1/models')) return jsonResponse({ data: [] });
  if (url.includes('/chat/completions')) {
    return jsonResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' } }, 401);
  }
  throw new Error(`t30-cloud-401.mjs 沒有預期到的請求:${url}`);
};
