/**
 * 07-teach-card / phase-6(問 AI,T68 側車、T69 畫面;ADR-086)的步驟定義 —— T68 這一半。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T68-teach-ask-core-sidecar.md。.feature:features/07-teach-card/phase-6.feature(12 個自動場景 + 1 個 `@manual`)。
 *
 * 接真的零件:真的側車子行程(`spawnSidecar`,跟 Rust 起的同一支 `scripts/review-sidecar.ts`)+ 假網路(`features/steps/_fake-ask-cloud.mjs`,
 * 換掉 fetch;真 router / adapter / 帳本照跑)。這裡只定義到**側車回應**:`teach.ask` 與 `teach.ask.poll` 回什麼、送給模型的提示有什麼、磁碟有沒有變、
 * 有沒有發網路請求。全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp)、`LC_REVIEW_TODAY` 釘 2026-09-10;不碰真的 learning/,不准 live。
 *
 * 兩張工單的句子怎麼分(T68 只做側車,畫面類的句子交 T69;兩邊不重複定義,`npm run check:steps` 要綠):
 *   T68 定義(本檔):
 *     Given  the teach card shows a card / ... with one unlearned prerequisite / ... whose prerequisites are all learned
 *            the AI answers {string} and suggests continuing / the AI suggests continuing / ... going deeper / ... going back to the basics
 *            the AI offers the follow-up questions {string} and {string} / the AI returns text that is not a valid answer
 *            the person has asked a question about the current card
 *            the computer is offline and no local model is available / ... and a local model is available
 *            today's LLM spending has reached the daily cap
 *     When   the person asks {string} / the person asks a question / the person asks a question and gets an answer / the person picks {string}
 *            the person presses next(共用句,在 teach-card.steps.ts 改派到這裡:`phase6Active` / `phase6PressNext`)
 *     Then   the card itself is unchanged / the teach card still shows the same card / no deeper card is generated until the person presses it
 *            {string} is sent as the next question / the earlier question and answer are part of what the AI is given
 *            the next question does not include the earlier discussion / the cards, the review state and the order file are unchanged / no AI call is made
 *   T69 定義(畫面;本檔不定義,cucumber 會報 undefined):
 *     Then   the answer {string} is shown under the card / the next button is highlighted / the deepen button is highlighted
 *            the prerequisite hint highlights that prerequisite / the answer says the AI suggests reviewing the basics / no control is highlighted
 *            no earlier question or answer is shown / the teach card says the answer could not be read and the person can ask again
 *            the teach card says no AI is available right now / the next button still works / the answer is marked as provisional
 *            the teach card says today's AI budget is used up
 *     T69 要在畫面那一側做同樣的事時,用本檔匯出的 `phase6Active` 分派(像 phase-5 的 `phase5Active`),不要再定義同一句。
 *
 * 只在 `@teach-card and @phase-6` 的場景掛 Before / After(只寫 @phase-6 會碰到別的 feature)。
 * 場景 13(`@manual`)是 T69 的,被預設的 `not @manual` 排除。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';
import { ledgerEvents, treeBytes } from '../support/review-session-harness.js';
import { request, spawnSidecar, type Sidecar } from '../support/review-sidecar-harness.js';
import { removeVault } from '../support/t43-harness.js';
import { AFTER_PARENT, PARENT, askAnswer, askOf, cardIdOf, createDeepenVault, isAsking, seedSpend, setPrereqs, type AskPayload, type Obj, type Vault } from '../support/t68-harness.js';

const FAKE = join(import.meta.dirname, '_fake-ask-cloud.mjs');
const TAGS = '@teach-card and @phase-6';
const FIRST_QUESTION = 'FIRST-QUESTION-TOKEN';
const SECOND_QUESTION = 'SECOND-QUESTION-TOKEN';
const A_QUESTION = 'A-QUESTION-TOKEN';
const FIRST_ANSWER = 'The list is sorted, so half of it can go (FIRST-ANSWER-TOKEN).';

interface Reply {
  answer: string;
  suggestion: 'continue' | 'deepen' | 'back';
  followups: string[];
}

interface Phase6State {
  vault: Vault | undefined;
  proc: Sidecar | undefined;
  ctrl: string;
  reqLog: string;
  nextId: number;
  offline: boolean;
  gatewayDown: boolean;
  unlearnedPrereq: boolean;
  spendUsd: number | undefined;
  reply: Reply;
  /** 非 undefined:模型回這段原文(壞掉的) */
  replyText: string | undefined;
  /** 打開卡片之後(第一個問題之前)學習目錄的位元組 */
  before: Record<string, string> | undefined;
  openedCard: string | undefined;
  asked: { question: string; done: Obj; ask: AskPayload | undefined }[];
}

const states = new WeakMap<LearningWorld, Phase6State>();
function st(world: LearningWorld): Phase6State {
  const s = states.get(world);
  assert.ok(s, '這個場景沒有 phase-6 的狀態(Before 沒跑?)');
  return s;
}

export function phase6Active(world: LearningWorld): boolean {
  return states.get(world) !== undefined;
}

Before({ tags: TAGS }, function (this: LearningWorld) {
  states.set(this, {
    vault: undefined,
    proc: undefined,
    ctrl: '',
    reqLog: '',
    nextId: 1,
    offline: false,
    gatewayDown: false,
    unlearnedPrereq: false,
    spendUsd: undefined,
    reply: { answer: FIRST_ANSWER, suggestion: 'continue', followups: [] },
    replyText: undefined,
    before: undefined,
    openedCard: undefined,
    asked: [],
  });
});

After({ tags: TAGS }, function (this: LearningWorld) {
  const s = states.get(this);
  if (!s) return;
  s.proc?.kill();
  if (s.vault) removeVault(s.vault);
  states.delete(this);
});

// ---------------------------------------------------------------- 世界

function ensureVault(world: LearningWorld): Vault {
  const s = st(world);
  if (s.vault) return s.vault;
  const vault = createDeepenVault();
  s.vault = vault;
  s.ctrl = join(vault.scratch, 'ctrl');
  mkdirSync(s.ctrl, { recursive: true });
  s.reqLog = join(vault.scratch, 'requests.log');
  writeFileSync(s.reqLog, '', 'utf8');
  if (s.unlearnedPrereq) setPrereqs(vault, PARENT, ['sec-0001', AFTER_PARENT]);
  if (s.spendUsd !== undefined) seedSpend(vault, s.spendUsd);
  return vault;
}

function writeReply(world: LearningWorld): void {
  const s = st(world);
  ensureVault(world);
  writeFileSync(join(s.ctrl, 'reply'), s.replyText ?? askAnswer({ answer: s.reply.answer, suggestion: s.reply.suggestion, followups: s.reply.followups }), 'utf8');
}

async function send(world: LearningWorld, method: string, params: Obj = {}): Promise<Obj> {
  const s = st(world);
  assert.ok(s.proc, '側車還沒起');
  const id = s.nextId;
  s.nextId += 1;
  return await request(s.proc, id, method, params);
}

/** 開側車(第一次需要它時才開:離線、上限這些 Given 要在側車起來之前就定下來),打開教學卡,記下「打開當下」的磁碟。 */
async function ensureOpen(world: LearningWorld): Promise<void> {
  const s = st(world);
  if (s.proc) return;
  const vault = ensureVault(world);
  writeReply(world);
  s.proc = spawnSidecar(vault, {
    fakeCloud: FAKE,
    env: {
      GATEWAY_API_KEY: 'fake-gateway-key',
      GATEWAY_BASE_URL: 'https://gateway.invalid',
      LLM_DAILY_CAP_USD: '1',
      FAKE_ASK_REQUEST_LOG: s.reqLog,
      FAKE_ASK_CTRL: s.ctrl,
      FAKE_ASK_OFFLINE: s.offline ? '1' : undefined,
      FAKE_ASK_GATEWAY_DOWN: s.gatewayDown ? '1' : undefined,
    },
  });
  const hello = await s.proc.nextLine(60_000);
  assert.ok(hello, `側車沒有在 60 秒內送出 hello(stderr:${s.proc.stderr().slice(-400)})`);
  assert.equal((JSON.parse(hello) as { kind?: string }).kind, 'hello', `第一行應該是 hello:${hello}`);
  const opened = await send(world, 'teach.open');
  assert.equal(opened['ok'], true, `teach.open 要成功:${JSON.stringify(opened)}`);
  s.openedCard = cardIdOf(opened);
  assert.ok(s.openedCard, `打開之後要有一張卡:${JSON.stringify(opened)}`);
  s.before = treeBytes(vault.dir);
}

async function askAndWait(world: LearningWorld, question: string): Promise<void> {
  await ensureOpen(world);
  const s = st(world);
  writeReply(world);
  const first = await send(world, 'teach.ask', { question });
  assert.equal(first['ok'], true, `teach.ask 要被接受:${JSON.stringify(first)}`);
  let done = first;
  const deadline = Date.now() + 60_000;
  while (askOf(done) === undefined && isAsking(done)) {
    assert.ok(Date.now() < deadline, 'teach.ask.poll 一直是 asking');
    await new Promise((r) => setTimeout(r, 40));
    done = await send(world, 'teach.ask.poll');
    assert.equal(done['ok'], true, `teach.ask.poll 要成功:${JSON.stringify(done)}`);
  }
  s.asked.push({ question, done, ask: askOf(done) });
}

function requests(world: LearningWorld): { n: number; via: string; prompt: string }[] {
  const s = st(world);
  return readFileSync(s.reqLog, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { n: number; via: string; prompt: string });
}

export async function phase6PressNext(world: LearningWorld): Promise<void> {
  await ensureOpen(world);
  const res = await send(world, 'teach.next');
  assert.equal(res['ok'], true, `teach.next 要照常執行:${JSON.stringify(res)}`);
}

// ---------------------------------------------------------------- Given

Given('the teach card shows a card', { timeout: 180_000 }, async function (this: LearningWorld) {
  await ensureOpen(this);
});

Given('the teach card shows a card with one unlearned prerequisite', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.vault, undefined, '前提要在世界建好之前設');
  s.unlearnedPrereq = true;
  await ensureOpen(this);
  const view = await send(this, 'teach.open');
  const prereqs = ((view['result'] as Obj)['prereqs'] ?? []) as { id: string }[];
  assert.deepEqual(prereqs.map((p) => p.id), [AFTER_PARENT], `前提:畫面先備提示恰好有一張未學的先備:${JSON.stringify(view)}`);
});

Given('the teach card shows a card whose prerequisites are all learned', { timeout: 180_000 }, async function (this: LearningWorld) {
  await ensureOpen(this);
  const view = await send(this, 'teach.open');
  assert.deepEqual(((view['result'] as Obj)['prereqs'] ?? []) as unknown[], [], `前提:沒有未學的先備:${JSON.stringify(view)}`);
});

Given('the AI answers {string} and suggests continuing', function (this: LearningWorld, answer: string) {
  const s = st(this);
  s.reply = { answer, suggestion: 'continue', followups: [] };
  writeReply(this);
});

Given('the AI suggests continuing', function (this: LearningWorld) {
  st(this).reply.suggestion = 'continue';
  writeReply(this);
});

Given('the AI suggests going deeper', function (this: LearningWorld) {
  st(this).reply.suggestion = 'deepen';
  writeReply(this);
});

Given('the AI suggests going back to the basics', function (this: LearningWorld) {
  st(this).reply.suggestion = 'back';
  writeReply(this);
});

Given('the AI offers the follow-up questions {string} and {string}', function (this: LearningWorld, a: string, b: string) {
  st(this).reply.followups = [a, b];
  writeReply(this);
});

Given('the AI returns text that is not a valid answer', function (this: LearningWorld) {
  st(this).replyText = 'Sure! Let us move on to the next card.';
  writeReply(this);
});

Given('the person has asked a question about the current card', { timeout: 180_000 }, async function (this: LearningWorld) {
  await askAndWait(this, FIRST_QUESTION);
  const last = st(this).asked[0]!;
  assert.ok(last.ask?.answer, `前提:第一個問題要有回答:${JSON.stringify(last.done)}`);
});

Given('the computer is offline and no local model is available', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.proc, undefined, '離線要在側車起來之前設');
  s.offline = true;
  s.gatewayDown = true;
});

Given('the computer is offline and a local model is available', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.proc, undefined, '離線要在側車起來之前設');
  s.offline = true;
  s.gatewayDown = false;
});

Given("today's LLM spending has reached the daily cap", function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.vault, undefined, '花費要在世界建好之前設');
  // LLM_DAILY_CAP_USD=1(側車環境),今天已花 1 美元:spent >= cap 就是用完
  s.spendUsd = 1;
});

// ---------------------------------------------------------------- When

When('the person asks {string}', { timeout: 180_000 }, async function (this: LearningWorld, question: string) {
  await askAndWait(this, question);
});

When('the person asks a question', { timeout: 180_000 }, async function (this: LearningWorld) {
  await askAndWait(this, A_QUESTION);
});

When('the person asks a question and gets an answer', { timeout: 180_000 }, async function (this: LearningWorld) {
  await askAndWait(this, A_QUESTION);
  const last = st(this).asked.at(-1)!;
  assert.ok(last.ask?.answer, `要有回答:${JSON.stringify(last.done)}`);
});

When('the person picks {string}', { timeout: 180_000 }, async function (this: LearningWorld, option: string) {
  const s = st(this);
  const last = s.asked.at(-1);
  assert.ok(last?.ask, '要先有一個回答才有追問選項可以點');
  assert.ok((last.ask.followups ?? []).includes(option), `追問選項要有 ${JSON.stringify(option)}:${JSON.stringify(last.ask.followups)}`);
  // 點追問選項 = 把那段字當成下一個問題送出去(只是文字,不是指令)
  await askAndWait(this, option);
});

// ---------------------------------------------------------------- Then

Then('the card itself is unchanged', function (this: LearningWorld) {
  const s = st(this);
  const vault = s.vault!;
  const now = treeBytes(vault.dir);
  for (const [file, bytes] of Object.entries(s.before ?? {})) {
    if (file === 'state/log.jsonl') continue;
    assert.equal(now[file], bytes, `${file} 被改了`);
  }
});

Then('the teach card still shows the same card', async function (this: LearningWorld) {
  const s = st(this);
  const view = await send(this, 'teach.poll');
  assert.equal(view['ok'], true, JSON.stringify(view));
  assert.equal(cardIdOf(view), s.openedCard, `卡不該換:${JSON.stringify(view)}`);
});

Then('no deeper card is generated until the person presses it', function (this: LearningWorld) {
  const s = st(this);
  const vault = s.vault!;
  const now = treeBytes(vault.dir);
  for (const [file, bytes] of Object.entries(s.before ?? {})) {
    if (file.startsWith('cards/') || file.startsWith('questions/') || file.startsWith('graph/')) assert.equal(now[file], bytes, `${file} 被改了`);
  }
  assert.deepEqual(
    Object.keys(now).filter((f) => f.startsWith('cards/') || f.startsWith('questions/') || f.startsWith('graph/')).sort(),
    Object.keys(s.before ?? {}).filter((f) => f.startsWith('cards/') || f.startsWith('questions/') || f.startsWith('graph/')).sort(),
    '沒有多出任何卡、考題、圖',
  );
  assert.equal(requests(this).length, s.asked.length, '網路上只有問答的請求,沒有深入的請求');
});

Then('{string} is sent as the next question', function (this: LearningWorld, question: string) {
  const reqs = requests(this);
  assert.ok(reqs.length >= 2, `至少兩個請求:${reqs.length}`);
  assert.ok(reqs.at(-1)!.prompt.includes(question), `最後一個請求的提示要有 ${JSON.stringify(question)}`);
});

Then('the earlier question and answer are part of what the AI is given', function (this: LearningWorld) {
  const s = st(this);
  const reqs = requests(this);
  const first = s.asked[0]!;
  const prompt = reqs.at(-1)!.prompt;
  assert.ok(prompt.includes(first.question), `提示要帶前一輪的問題 ${first.question}`);
  assert.ok(prompt.includes(first.ask?.answer ?? '(沒有回答)'), `提示要帶前一輪的回答:${first.ask?.answer}`);
});

Then('the next question does not include the earlier discussion', { timeout: 180_000 }, async function (this: LearningWorld) {
  const s = st(this);
  const earlier = s.asked[0]!;
  const before = requests(this).length;
  await askAndWait(this, SECOND_QUESTION);
  const reqs = requests(this);
  assert.equal(reqs.length, before + 1, '新的問題要真的送出去');
  const prompt = reqs.at(-1)!.prompt;
  assert.ok(prompt.includes(SECOND_QUESTION), '提示有這一輪的問題');
  assert.ok(!prompt.includes(earlier.question), `提示不該帶前面的問題 ${earlier.question}`);
  assert.ok(!prompt.includes(earlier.ask?.answer ?? '(沒有回答)'), '提示不該帶前面的回答');
});

Then('the cards, the review state and the order file are unchanged', function (this: LearningWorld) {
  const s = st(this);
  const vault = s.vault!;
  const now = treeBytes(vault.dir);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(s.before ?? {}).sort(), '沒有多出或少掉任何檔');
  for (const [file, bytes] of Object.entries(s.before ?? {})) {
    if (file === 'state/log.jsonl') continue;
    assert.equal(now[file], bytes, `${file} 被改了`);
  }
  // log.jsonl 只多 router 記的 llm_call 行
  const oldLog = Buffer.from((s.before ?? {})['state/log.jsonl'] ?? '', 'base64').toString('utf8');
  const newLog = Buffer.from(now['state/log.jsonl'] ?? '', 'base64').toString('utf8');
  assert.ok(newLog.startsWith(oldLog), 'log.jsonl 原有的內容不能被改');
  for (const line of newLog.slice(oldLog.length).split('\n').filter((l) => l.trim() !== '')) {
    const event = JSON.parse(line) as { type?: string; task?: string };
    assert.deepEqual([event.type, event.task], ['llm_call', 'teach.ask'], `log.jsonl 只該多 llm_call(teach.ask):${line}`);
  }
});

Then('no AI call is made', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(requests(this), [], '到上限還發了模型請求');
  const calls = ledgerEvents(s.vault!).filter((e) => e['type'] === 'llm_call' && e['task'] === 'teach.ask');
  assert.deepEqual(calls, [], '帳本不該有 teach.ask 的 llm_call');
  assert.ok(s.asked.length >= 1, '前提:真的問過');
  assert.equal(s.asked.at(-1)!.ask?.error, 'budget', `回的是 budget 錯誤:${JSON.stringify(s.asked.at(-1)!.done)}`);
});
