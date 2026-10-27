/**
 * 05-grading/phase-3(縮短版生成,T65)的步驟定義。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T65-grading-phase3-short-and-queue.md。.feature:features/05-grading/phase-3.feature(3 個場景,沒有 @manual)。
 *
 * 用假 router(逐次回事先排好的回應;離線時回應標 provisional),暫存學習資料夾,真的 ProvisionalQueue;不打網路、不花錢。
 * 被測模組用動態 import 算出來的 file URL(紅測試在 base 上要 tsc 乾淨,新檔在 base 上還不存在)。
 * 只在 `@grading and @phase-3` 的場景掛 Before/After(只寫 @phase-3 會碰到 03/06/07/10 的場景)。
 *
 * 兩句跟別的功能撞名的步驟(the network is available / unavailable)的接縫見 _grading-phase3-shared.ts。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProvisionalQueue, provisionalQueuePath } from '../../packages/core/src/llm/provisional-queue.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { countWords } from '../../packages/core/src/schema/word-count.js';
import { gradingPhase3Hooks } from './_grading-phase3-shared.js';
import type { LearningWorld } from './_world.js';

const MODULE = join(import.meta.dirname, '../../packages/core/src/grading/reteach-short.ts');
const LIMIT = 20;
const CARD_ID = 'sec-0001';
const TAGS = '@grading and @phase-3';
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const CARD = {
  frontmatter: {
    id: CARD_ID,
    category: 'security',
    title: '同源政策',
    level: 0,
    source: 'raw',
    source_ref: 'raw/security/web-basics.md#L3-L16',
    created: '2026-09-01',
    prereqs: [] as string[],
    provisional: false,
    stale: false,
    source_missing: false,
  },
  body: '原卡的內文:同源政策限制一個來源的文件去讀另一個來源的資源,來源由協定、主機與連接埠三個部分一起決定,任何一個不同就算不同來源。',
  examples: ['範例一:https://a.example 讀 https://b.example 會被擋。', '範例二:同協定同主機同連接埠才算同源。'],
};

const reply = (n: number, mark: string): string => JSON.stringify({ body: mark.repeat(n), example: '縮短版的例子' });
const bodyLen = (text: string): number => countWords((JSON.parse(text) as { body: string }).body);

interface Call {
  task: string;
  prompt: string;
  text: string;
}
interface G3 {
  dir: string;
  online: boolean;
  /** 逐次回應;不夠用時重複最後一個 */
  script: string[];
  calls: Call[];
  events: Record<string, unknown>[];
  outcome?: { kind: string; path?: string; provisional?: boolean; attempts?: number };
}
const states = new WeakMap<LearningWorld, G3>();
function st(world: LearningWorld): G3 {
  const s = states.get(world);
  assert.ok(s, '這個場景沒有 phase-3 的狀態(Before 沒跑?)');
  return s;
}
const shortPath = (s: G3): string => join(s.dir, 'cards/security', `${CARD_ID}.short.md`);
const readShort = (s: G3): { frontmatter: Record<string, unknown>; body: string; examples: string[] } => {
  assert.ok(existsSync(shortPath(s)), `沒有縮短版檔:${shortPath(s)}`);
  return parseCardText(readFileSync(shortPath(s), 'utf8'));
};

Before({ tags: TAGS }, function (this: LearningWorld) {
  const dir = mkdtempSync(join(tmpdir(), 'lc-t65-steps-'));
  mkdirSync(join(dir, 'cards/security'), { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'cards/security', `${CARD_ID}.md`), 'ORIGINAL-CARD-FILE\n');
  states.set(this, { dir, online: true, script: [reply(10, '短')], calls: [], events: [] });
});

After({ tags: TAGS }, function (this: LearningWorld) {
  const s = states.get(this);
  if (s) rmSync(s.dir, { recursive: true, force: true });
  states.delete(this);
});

gradingPhase3Hooks.network = (world, online) => {
  st(world).online = online;
};

// ---------------------------------------------------------------- Given

Given('a card is queued for reteach', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(countWords(CARD.body) > LIMIT, '原卡的 body 要比縮短版上限長,縮短才有意義');
  assert.ok(existsSync(join(s.dir, 'cards/security', `${CARD_ID}.md`)));
});

Given('the first attempt exceeds the short limit', function (this: LearningWorld) {
  // 三次都太長、字數各不相同,最短的是第二次(24):場景 2 的兩個 Then 一起量得到。
  st(this).script = [reply(31, '甲'), reply(24, '乙'), reply(29, '丙')];
});

// ---------------------------------------------------------------- When

When('the shortened version is generated', async function (this: LearningWorld) {
  const s = st(this);
  const mod = (await import(pathToFileURL(MODULE).href)) as { generateShort: (a: Record<string, unknown>) => Promise<NonNullable<G3['outcome']>> };
  const router = {
    async call(task: string, prompt: string) {
      const text = s.script[Math.min(s.calls.length, s.script.length - 1)]!;
      s.calls.push({ task, prompt, text });
      return { text, provider: s.online ? 'anthropic' : 'ollama', model: 'fake', latency_ms: 1, provisional: !s.online };
    },
    async probeOnline() {
      return s.online;
    },
    async probeLocal() {
      return { available: !s.online, models: [] };
    },
  };
  const log = (e: Record<string, unknown>): void => {
    s.events.push(e);
  };
  const queue = new ProvisionalQueue({ path: provisionalQueuePath(s.dir), log: log as never });
  s.outcome = await mod.generateShort({ learningDir: s.dir, card: CARD, router, shortLimit: LIMIT, queue, log });
});

// ---------------------------------------------------------------- Then

Then('a model call is made for the reteach task', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.calls.length >= 1, '沒有呼叫模型');
  for (const c of s.calls) assert.equal(c.task, 'reteach.short');
});

Then('the prompt contains the original body and examples', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.calls[0]!.prompt.includes(CARD.body), 'prompt 裡沒有原卡的 body');
  for (const ex of CARD.examples) assert.ok(s.calls[0]!.prompt.includes(ex), `prompt 裡沒有原卡的 example:${ex}`);
});

Then('the produced body is within the short limit', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.outcome?.kind, 'written');
  const n = countWords(readShort(s).body);
  assert.ok(n <= LIMIT, `body ${n} 字,超過上限 ${LIMIT}`);
});

Then('it contains exactly one example', function (this: LearningWorld) {
  assert.equal(readShort(st(this)).examples.length, 1);
});

Then('it is written alongside the original card', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.outcome?.kind, 'written');
  assert.equal(s.outcome?.path, shortPath(s));
  assert.equal(dirname(shortPath(s)), dirname(join(s.dir, 'cards/security', `${CARD_ID}.md`)));
  assert.equal(readFileSync(join(s.dir, 'cards/security', `${CARD_ID}.md`), 'utf8'), 'ORIGINAL-CARD-FILE\n', '原卡檔不能被動');
});

Then('it is regenerated until it fits or three attempts are used', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(s.calls.length >= 2, `第一次太長,要重新生成;實際只叫了 ${s.calls.length} 次`);
  assert.ok(s.calls.length <= 3, `最多三次;實際叫了 ${s.calls.length} 次`);
  const lens = s.calls.map((c) => bodyLen(c.text));
  const fitAt = lens.findIndex((n) => n <= LIMIT);
  if (fitAt !== -1) assert.equal(s.calls.length, fitAt + 1, '有一次夠短就該停,不再重試');
  else assert.equal(s.calls.length, 3, '三次都太長,要用滿三次');
});

Then('if all three are too long the shortest is kept and a warning is logged', function (this: LearningWorld) {
  const s = st(this);
  const lens = s.calls.map((c) => bodyLen(c.text));
  const overlong = s.events.filter((e) => e['type'] === 'warning' && e['reason'] === 'reteach_short_overlong');
  if (s.calls.length === 3 && lens.every((n) => n > LIMIT)) {
    const best = lens.indexOf(Math.min(...lens));
    assert.equal(readShort(s).body, (JSON.parse(s.calls[best]!.text) as { body: string }).body, '三次都太長時要留字數最少的那一次');
    assert.equal(overlong.length, 1, '三次都太長要記一筆 reteach_short_overlong');
  } else {
    assert.equal(overlong.length, 0, '有一次夠短,不該記 overlong');
  }
});

Then('the file is marked provisional', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.outcome?.kind, 'written');
  assert.equal(s.outcome?.provisional, true);
  assert.equal(readShort(s).frontmatter['provisional'], true);
});

Then('it enters the provisional queue', async function (this: LearningWorld) {
  const s = st(this);
  const queue = new ProvisionalQueue({ path: provisionalQueuePath(s.dir), log: () => undefined });
  const entries = await queue.list();
  assert.equal(entries.length, 1, '佇列要剛好一筆');
  assert.equal(entries[0]!.task, 'reteach.short');
  assert.equal(entries[0]!.card, CARD_ID);
  const kept = s.calls[s.calls.length - 1]!;
  assert.equal(entries[0]!.local_sha256, sha(kept.text));
  assert.equal(entries[0]!.prompt, kept.prompt);
});
