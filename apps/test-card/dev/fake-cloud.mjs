/**
 * 單獨執行的假網路層(ADR-075、ADR-022)。
 * 側車啟動時用 LC_REVIEW_FAKE_CLOUD 載入,換掉 fetch。
 * router、adapter、帳本照樣跑真的,只是不打真網路。
 * 填空同義詞回 no;應用題回每一條 rubric 都過的合法 JSON。
 * 不 import features/ 底下的檔。
 */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function rubricCount(prompt) {
  const n = String(prompt).split('\n').filter((line) => /^\d+\. /.test(line)).length;
  return n > 0 ? n : 1;
}

function replyFor(prompt) {
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

  if (url.includes('/v1/models')) return jsonResponse({ data: [] });

  if (url.includes('/auth/token/exchange')) {
    return jsonResponse({ access_token: 'fake-token', expires_in: 3600 });
  }

  if (url.includes('/gateway/models')) {
    return jsonResponse({ auto_match: false, models: { 'qwen2.5:32b': ['ready'] } });
  }

  if (url.includes('/chat/completions')) {
    const body = JSON.parse(await readBody(input, init));
    const prompt = String(body.messages?.[0]?.content ?? '');
    return jsonResponse({
      id: 'chatcmpl_fake_review',
      object: 'chat.completion',
      created: 0,
      model: typeof body.model === 'string' ? body.model : 'fake-model',
      choices: [{ index: 0, message: { role: 'assistant', content: replyFor(prompt) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  }

  if (url.includes('/gateway/chat')) {
    const body = JSON.parse(await readBody(input, init));
    return jsonResponse({
      content: replyFor(body.prompt),
      provider: 'ollama',
      model: typeof body.model === 'string' ? body.model : 'qwen2.5:32b',
      tokens_used: { prompt: 10, completion: 5 },
    });
  }

  throw new Error(`fake-cloud.mjs 沒有預期到的請求:${url}`);
};
