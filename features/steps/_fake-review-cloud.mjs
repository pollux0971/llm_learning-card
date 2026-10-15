/**
 * I2 的 scripts/review.ts 驗收用:子程序的假網路層(照 _fake-cloud.mjs 的模式——review.ts 自己組 router,
 * 沒有注入點,而「CLI 真的接上了雲端 router、並且記了帳」正是 I2 要驗的東西,所以不能繞過它)。
 *
 * 用 `--import` 載入;副檔名刻意是 .mjs,cucumber 的 import glob 只抓 .ts,不會把這個檔載進 cucumber 自己的程序。
 * 換掉 globalThis.fetch 之後,CloudLlmRouter / openaiAdapter / OpenAI SDK 全部跑真的,只是不打真網路。
 *
 * 環境變數:
 *   FAKE_REVIEW_REQUEST_LOG   每一個 chat completions 請求在這個檔案追加一行 JSON({"prompt": …});
 *                             沒設就不記。測試用它數「雲端被呼叫幾次」。
 */
import { appendFileSync } from 'node:fs';
import { scriptedApplyReply } from './_i2-cloud-script.ts';

const REQUEST_LOG = process.env.FAKE_REVIEW_REQUEST_LOG ?? '';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async function fakeReviewCloudFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // CloudLlmRouter.probeOnline():GET /v1/models,只看 status < 500
  if (url.includes('/v1/models')) return jsonResponse({ data: [] });

  if (url.includes('/chat/completions')) {
    const raw = init?.body ?? (input && typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '');
    const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    const prompt = String(body.messages?.[0]?.content ?? '');
    if (REQUEST_LOG) appendFileSync(REQUEST_LOG, `${JSON.stringify({ prompt })}\n`);
    return jsonResponse({
      id: 'chatcmpl_fake_review',
      object: 'chat.completion',
      created: 0,
      model: body.model ?? 'fake-model',
      choices: [{ index: 0, message: { role: 'assistant', content: scriptedApplyReply(prompt) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }

  throw new Error(`_fake-review-cloud.mjs 沒有預期到的請求:${url}`);
};
