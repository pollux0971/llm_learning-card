/**
 * T68(07 phase-6 問 AI):側車子行程的假網路層(`--import` 載入,換掉 globalThis.fetch;真的 router / adapter / 帳本照跑)。
 * 副檔名 .mjs:cucumber 的 import glob 只抓 .ts,不會把它載進 cucumber 自己的程序。測試 agent 寫。
 *
 * 這一版只服務「問 AI」:每一個模型請求(雲端 chat completions 或閘道 chat)都當成一次 teach.ask 的呼叫。
 *
 * 環境變數:
 *   FAKE_ASK_REQUEST_LOG     每個模型請求在**到達的當下**追加一行 JSON
 *                            {"n":第幾個,"via":"cloud"|"gateway","maxTokens":送給模型的 token 上限,"prompt":整份提示}
 *   FAKE_ASK_CTRL            控制目錄:
 *                              - `hold` 這個檔存在,請求到達後就一直等到它被刪掉才回應(確定性地讓「手上有一個呼叫」,不靠計時)
 *                              - 回應文字:先找 `reply-<n>`(第 n 個請求),再找 `reply`,都沒有就用預設的好回答
 *                              - 檔案內容原樣當成模型回的文字(可以放壞掉的 JSON)
 *   FAKE_ASK_OFFLINE=1       雲端不通:`/v1/models` 回 503,chat completions 丟連線錯(router 會走閘道)
 *   FAKE_ASK_GATEWAY_DOWN=1  閘道不通(離線又沒有本機 → NO_MODEL)
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUEST_LOG = process.env.FAKE_ASK_REQUEST_LOG ?? '';
const CTRL = process.env.FAKE_ASK_CTRL ?? '';
const OFFLINE = process.env.FAKE_ASK_OFFLINE === '1';
const GATEWAY_DOWN = process.env.FAKE_ASK_GATEWAY_DOWN === '1';

export const DEFAULT_ANSWER = JSON.stringify({ answer: '因為清單已經排好了,所以可以每次丟掉一半。', suggestion: 'continue', followups: ['沒排好會怎樣?'] });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let seen = 0;

async function handleModel(via, prompt, maxTokens) {
  seen += 1;
  const n = seen;
  if (REQUEST_LOG) appendFileSync(REQUEST_LOG, `${JSON.stringify({ n, via, maxTokens, prompt })}\n`);
  if (CTRL) while (existsSync(join(CTRL, 'hold'))) await nap(20);
  if (CTRL) {
    for (const name of [`reply-${n}`, 'reply']) {
      const path = join(CTRL, name);
      if (existsSync(path)) return readFileSync(path, 'utf8');
    }
  }
  return DEFAULT_ANSWER;
}

globalThis.fetch = async function fakeAskFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.includes('/v1/models')) return OFFLINE ? json({ error: 'offline' }, 503) : json({ data: [] });

  if (url.includes('/chat/completions')) {
    if (OFFLINE) throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });
    const raw = init?.body ?? (input && typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '');
    const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    const prompt = String(body.messages?.[0]?.content ?? '');
    const text = await handleModel('cloud', prompt, body.max_completion_tokens ?? body.max_tokens ?? null);
    return json({
      id: 'chatcmpl_fake_ask',
      object: 'chat.completion',
      created: 0,
      model: body.model ?? 'fake-model',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }

  if (url.includes('/auth/token/exchange')) return json({ access_token: 'fake-token', expires_in: 3600 });
  if (url.includes('/gateway/models')) return GATEWAY_DOWN ? json({ error: 'down' }, 503) : json({ models: { 'fake-local': {} } });
  if (url.includes('/gateway/chat')) {
    if (GATEWAY_DOWN) return json({ error: 'down' }, 503);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const text = await handleModel('gateway', String(body.prompt ?? ''), body.max_tokens ?? null);
    return json({ content: text, model: 'fake-local', tokens_used: { prompt: 10, completion: 20 } });
  }

  throw new Error(`_fake-ask-cloud.mjs 沒有預期到的請求:${url}`);
};
