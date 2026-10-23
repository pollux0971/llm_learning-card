/**
 * 教學卡單獨執行的假網路層(ADR-079)。
 * 側車啟動時用 LC_REVIEW_FAKE_CLOUD 載入,換掉 fetch。
 * router、adapter、帳本照樣跑真的,只是不打真網路。
 * 深入回兩張合格的子卡與考題,模型回應前等約 1.5 秒,看得到生成中。
 * 不 import 測試步驟或 cucumber 支援檔。
 */

const DELAY_MS = 1500;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function nap(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function kindOf(prompt) {
  const text = String(prompt);
  if (text.includes('previous body:')) return 'regenerate';
  if (text.includes('parent_id:')) return 'children';
  if (/^card:\s*\S+$/m.test(text)) return 'questions';
  return 'other';
}

function childrenReply() {
  return JSON.stringify([
    { title: '新卡1', body: '這是第一張新產生的子卡,說明父卡的其中一個面向。', examples: [] },
    { title: '新卡2', body: '這是第二張新產生的子卡,說明父卡的另一個面向。', examples: [] },
  ]);
}

function questionsReply() {
  return JSON.stringify({
    fill: [
      { prompt: '同源的判定條件是 ___、___ 兩者相同。', answers: [['協定'], ['主機']] },
      { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
    ],
    apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }],
  });
}

function rubricCount(prompt) {
  const n = String(prompt).split('\n').filter((line) => /^\d+\. /.test(line)).length;
  return n > 0 ? n : 1;
}

function replyFor(prompt) {
  const kind = kindOf(prompt);
  if (kind === 'children') return childrenReply();
  if (kind === 'regenerate') return JSON.stringify([{ title: '', body: '重寫之後合格的短內文。', examples: [] }]);
  if (kind === 'questions') return questionsReply();
  const text = String(prompt);
  if (text.includes('是否語意相同')) return 'no';
  return JSON.stringify({
    criteria: Array.from({ length: rubricCount(text) }, () => true),
    feedback: '每一條都達成。',
  });
}

async function readBody(input, init) {
  const raw = init?.body ?? (input && typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '');
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  return '';
}

globalThis.fetch = async function fakeCloudFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (url.includes('/v1/models')) return jsonResponse({ data: [{ id: 'fake-model' }] });

  if (url.includes('/auth/token/exchange')) {
    return jsonResponse({ access_token: 'fake-token', expires_in: 3600 });
  }

  if (url.includes('/gateway/models')) {
    return jsonResponse({ auto_match: false, models: { 'qwen2.5:32b': ['ready'] } });
  }

  if (url.includes('/chat/completions')) {
    const body = JSON.parse(await readBody(input, init));
    const first = Array.isArray(body.messages) ? body.messages[0] : undefined;
    const prompt = first && typeof first.content === 'string' ? first.content : '';
    await nap(DELAY_MS);
    return jsonResponse({
      id: 'chatcmpl_fake_teach',
      object: 'chat.completion',
      created: 0,
      model: typeof body.model === 'string' ? body.model : 'fake-model',
      choices: [{ index: 0, message: { role: 'assistant', content: replyFor(prompt) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }

  if (url.includes('/gateway/chat')) {
    const body = JSON.parse(await readBody(input, init));
    await nap(DELAY_MS);
    return jsonResponse({
      content: replyFor(body.prompt),
      provider: 'ollama',
      model: typeof body.model === 'string' ? body.model : 'qwen2.5:32b',
      tokens_used: { prompt: 10, completion: 5 },
    });
  }

  throw new Error(`fake-cloud.mjs 沒有預期到的請求:${url}`);
};
