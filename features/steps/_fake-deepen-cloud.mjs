/**
 * T43(07 phase-3 深入這個):側車子行程的假網路層(`--import` 載入,換掉 globalThis.fetch,真的 router / adapter / 帳本照跑)。
 * 副檔名 .mjs:cucumber 的 import glob 只抓 .ts,不會把它載進 cucumber 自己的程序。測試 agent 寫。
 *
 * 環境變數:
 *   FAKE_DEEPEN_REQUEST_LOG   每個模型請求(雲端 chat completions 或閘道 chat)在**到達的當下**追加一行 JSON
 *                             {"via":"cloud"|"gateway","kind":"children"|"regenerate"|"questions"|"other","card":…,"title":…}
 *   FAKE_DEEPEN_CTRL          控制目錄。請求到達後,只要 `<CTRL>/hold-<kind>` 這個檔存在,就一直等到它被刪掉才回應
 *                             (確定性地讓「手上有一個呼叫」,不靠計時)
 *   FAKE_DEEPEN_OFFLINE=1     雲端不通:`/v1/models` 回 503,chat completions 丟連線錯(router 會走閘道)
 *   FAKE_DEEPEN_GATEWAY_DOWN=1  閘道不通:`/gateway/models` 回 503(離線又沒有本機 → no-model)
 *   FAKE_DEEPEN_CHILDREN      子卡張數(預設 2);FAKE_DEEPEN_BAD_CHILDREN=1 → 子卡回應不是 JSON
 *   FAKE_DEEPEN_LONG_TITLE    這個標題的卡永遠超過 100 字(重寫也超過)
 *   FAKE_DEEPEN_SLOW_MS       每個模型回應前多等幾毫秒(預設 0)
 */
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUEST_LOG = process.env.FAKE_DEEPEN_REQUEST_LOG ?? '';
const CTRL = process.env.FAKE_DEEPEN_CTRL ?? '';
const OFFLINE = process.env.FAKE_DEEPEN_OFFLINE === '1';
const GATEWAY_DOWN = process.env.FAKE_DEEPEN_GATEWAY_DOWN === '1';
const CHILDREN = Number(process.env.FAKE_DEEPEN_CHILDREN ?? '2');
const BAD_CHILDREN = process.env.FAKE_DEEPEN_BAD_CHILDREN === '1';
const LONG_TITLE = process.env.FAKE_DEEPEN_LONG_TITLE ?? '';
const SLOW_MS = Number(process.env.FAKE_DEEPEN_SLOW_MS ?? '0');

const LONG_BODY = Array.from({ length: 101 }, (_, i) => `w${i}`).join(' ');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function kindOf(prompt) {
  if (prompt.includes('previous body:')) return 'regenerate';
  if (prompt.includes('parent_id:')) return 'children';
  if (/^card:\s*\S+$/m.test(prompt)) return 'questions';
  return 'other';
}

function replyFor(kind, prompt) {
  if (kind === 'children') {
    if (BAD_CHILDREN) return '這不是 JSON';
    return JSON.stringify(
      Array.from({ length: CHILDREN }, (_, i) => ({
        title: `新卡${i + 1}`,
        body: LONG_TITLE === `新卡${i + 1}` ? LONG_BODY : `這是第 ${i + 1} 張新產生的子卡內文,說明父卡的其中一個面向。`,
        examples: [],
      })),
    );
  }
  if (kind === 'regenerate') {
    const title = /^title:\s*(.+)$/m.exec(prompt)?.[1]?.trim() ?? '';
    return JSON.stringify([{ title, body: title === LONG_TITLE ? LONG_BODY : '重寫之後合格的短內文。', examples: [] }]);
  }
  if (kind === 'questions') {
    return JSON.stringify({
      fill: [
        { prompt: '同源的判定條件是 ___、___ 兩者相同。', answers: [['協定'], ['主機']] },
        { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
      ],
      apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }],
    });
  }
  return 'no';
}

async function handleModel(via, prompt) {
  const kind = kindOf(prompt);
  if (REQUEST_LOG) {
    const card = kind === 'questions' ? /^card:\s*(\S+)$/m.exec(prompt)?.[1] : kind === 'children' ? /^parent_id:\s*(\S+)$/m.exec(prompt)?.[1] : undefined;
    const title = kind === 'questions' || kind === 'regenerate' ? /^title:\s*(.+)$/m.exec(prompt)?.[1]?.trim() : undefined;
    appendFileSync(REQUEST_LOG, `${JSON.stringify({ via, kind, card, title })}\n`);
  }
  if (CTRL) while (existsSync(join(CTRL, `hold-${kind}`))) await nap(20);
  if (SLOW_MS > 0) await nap(SLOW_MS);
  return replyFor(kind, prompt);
}

globalThis.fetch = async function fakeDeepenFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.includes('/v1/models')) return OFFLINE ? json({ error: 'offline' }, 503) : json({ data: [] });

  if (url.includes('/chat/completions')) {
    if (OFFLINE) throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });
    const raw = init?.body ?? (input && typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '');
    const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    const prompt = String(body.messages?.[0]?.content ?? '');
    const text = await handleModel('cloud', prompt);
    return json({
      id: 'chatcmpl_fake_deepen',
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
    const text = await handleModel('gateway', String(body.prompt ?? ''));
    return json({ content: text, model: 'fake-local', tokens_used: { prompt: 10, completion: 20 } });
  }

  throw new Error(`_fake-deepen-cloud.mjs 沒有預期到的請求:${url}`);
};
