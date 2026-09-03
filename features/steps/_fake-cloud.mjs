/**
 * 給「真的跑一次 CLI」的驗收步驟用的假雲端層(features/steps/ingest-pipeline.steps.ts
 * 的 "the command prints the failed card and exits with a non-zero status")。
 *
 * 這個檔案是子程序的 `--import` 入口,不是步驟定義——副檔名刻意用 .mjs,
 * cucumber.js 的 `import: ['features/steps/**\/*.ts']` 不會把它載進 cucumber 自己的
 * 程序(載進去的話,下面覆寫 globalThis.fetch 的副作用會汙染所有場景)。
 *
 * 為什麼是覆寫 fetch 而不是注入 router:scripts/ingest.ts 直接 `new LlmRouterImpl(...)`,
 * 沒有注入點,而 CLI 那一段(參數解析、ensureInitialized、複製 raw、印出清單、退出碼)
 * 正是這個場景要驗的東西——不能繞過它。改在最外層的網路邊界造假,LlmRouterImpl /
 * CloudLlmRouter / anthropicAdapter / Anthropic SDK 全都跑真的:
 *   - CloudLlmRouter.probeOnline() 用全域 fetch 打 https://api.anthropic.com/v1/models
 *   - anthropicAdapter 用 Anthropic SDK,SDK 建構時取 globalThis.fetch(見
 *     @anthropic-ai/sdk/internal/shims.mjs 的 getDefaultFetch())
 * 兩者都會拿到下面這個 stub,整個測試不打真網路。
 *
 * 環境變數:
 *   FAKE_CLOUD_LEVEL0_COUNT        level 0 卡片張數(預設 5)
 *   FAKE_CLOUD_CHILDREN_PER_PARENT 每張父卡的子卡數(預設 1)
 *   FAKE_CLOUD_QUESTIONS_FAIL_CARD 這張卡的 'ingest.questions' 每次都回不合法的回應
 */

const LEVEL0_COUNT = Number(process.env.FAKE_CLOUD_LEVEL0_COUNT ?? '5');
const CHILDREN_PER_PARENT = Number(process.env.FAKE_CLOUD_CHILDREN_PER_PARENT ?? '1');
const FAIL_CARD = process.env.FAKE_CLOUD_QUESTIONS_FAIL_CARD ?? '';

function levelZeroCandidatesJson(count) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      title: `第 ${i + 1} 個概念`,
      body: `這是第 ${i + 1} 張卡的正文內容,描述同源政策的其中一個面向。`,
      examples: [],
      lines: [i * 2 + 1, i * 2 + 2],
    })),
  );
}

function childCandidatesJson(count) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      title: `子概念 ${i + 1}`,
      body: `子概念 ${i + 1} 的細節說明,展開自父卡的其中一個面向。`,
      examples: [],
    })),
  );
}

function questionCandidateJson() {
  return JSON.stringify({
    fill: [
      { prompt: '同源的判定條件是 ___、___、___ 三者相同。', answers: [['協定'], ['主機'], ['埠號']] },
      { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
    ],
    apply: [
      { prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] },
    ],
  });
}

/** 依 prompt 裡「- <id>: <title>」的列表串成一條鏈,保證圖包含每張卡且無循環。 */
function depsEdgesJsonFromPrompt(prompt) {
  const ids = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]);
  const edges = [];
  for (let i = 0; i + 1 < ids.length; i++) edges.push([ids[i], ids[i + 1]]);
  return JSON.stringify({ edges });
}

/** 從 prompt 認出這是哪一個 LlmTask——CLI 這一路只會用到這三種。 */
function replyTextFor(prompt) {
  if (prompt.includes('parent_id:')) return childCandidatesJson(CHILDREN_PER_PARENT);

  const cardMatch = /^card:\s*(\S+)$/m.exec(prompt);
  if (cardMatch) {
    const cardId = cardMatch[1];
    // 確定性的失敗:回一段不是 JSON 的文字,generateQuestions() 會直接丟錯、不重試。
    if (cardId === FAIL_CARD) return `模型無法為 ${cardId} 生成考題`;
    return questionCandidateJson();
  }

  if (/^cards:$/m.test(prompt)) return depsEdgesJsonFromPrompt(prompt);
  return levelZeroCandidatesJson(LEVEL0_COUNT);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async function fakeCloudFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // CloudLlmRouter.probeOnline():GET /v1/models,只看 status < 500
  if (url.includes('/v1/models')) return jsonResponse({ data: [] });

  if (url.includes('/v1/messages')) {
    const raw = init?.body ?? (input && typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '');
    const body = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    const prompt = body.messages?.[0]?.content ?? '';
    return jsonResponse({
      id: 'msg_fake_cloud',
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'fake-model',
      content: [{ type: 'text', text: replyTextFor(String(prompt)) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }

  throw new Error(`_fake-cloud.mjs 沒有預期到的請求:${url}`);
};
