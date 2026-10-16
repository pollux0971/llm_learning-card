/**
 * 02-ingest-pipeline / phase-4(T18):子卡生成時看得到同分類的其他卡(`already_covered:`)。
 *
 * 走真的 `generateChildren` / `generateChildrenForCards`(packages/core/src/ingest/children.ts),
 * 假 router 只記下送出的 prompt、回固定的子卡,不呼叫真的 LLM;一律暫存目錄。
 * 句子都是這個 feature 自己的(已 grep 過 features/steps/,不跟 phase-1、phase-2 撞名)。
 */
import { After, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Card } from '../../packages/contracts/src/index.js';
import type { LlmResult, LlmRouter } from '../../packages/core/src/llm/index.js';
import { generateChildren, generateChildrenForCards } from '../../packages/core/src/ingest/children.js';
import { loadPromptTemplate } from '../../packages/core/src/ingest/prompts.js';
import type { LearningWorld } from './_world.js';

const CATEGORY = 'security';

interface P4State {
  root: string;
  parent: Card;
  parents: Card[];
  /** 其他卡:id → 標題與 body 的第一句(預期的摘要) */
  others: { id: string; title: string; summary: string }[];
  prompts: string[];
}
const states = new WeakMap<LearningWorld, P4State>();

function st(world: LearningWorld): P4State {
  const s = states.get(world);
  assert.ok(s, '這個場景還沒建立分類');
  return s;
}

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (s) rmSync(s.root, { recursive: true, force: true });
});

function makeCard(id: string, title: string, body: string, category = CATEGORY): Card {
  return {
    frontmatter: {
      id,
      category,
      title,
      level: 0,
      source: 'raw',
      created: '2026-09-01',
      source_ref: `raw/${category}/x.md#L1-L2`,
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
    },
    body,
    examples: [],
  };
}

function putCard(root: string, card: Card): void {
  const fm = card.frontmatter;
  const dir = join(root, 'cards', fm.category);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${fm.id}.md`),
    `---\nid: ${fm.id}\ncategory: ${fm.category}\ntitle: ${fm.title}\nlevel: 0\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/${fm.category}/x.md#L1-L2\nprereqs: []\n---\n\n${card.body}\n`,
    'utf8',
  );
}

function newState(world: LearningWorld): P4State {
  const root = mkdtempSync(join(tmpdir(), 'lc-t18-p4-'));
  world.dir = root;
  const parent = makeCard('sec-0001', '父卡', '父卡的內文。');
  putCard(root, parent);
  const s: P4State = { root, parent, parents: [parent], others: [], prompts: [] };
  states.set(world, s);
  return s;
}

function addOther(s: P4State, id: string): void {
  const title = `兄弟卡${id}`;
  putCard(s.root, makeCard(id, title, `${id} 講的第一件事。第二句不出現。`));
  s.others.push({ id, title, summary: `${id} 講的第一件事。` });
}

function recordingRouter(s: P4State): LlmRouter {
  let n = 0;
  return {
    async call(task, prompt): Promise<LlmResult> {
      if (task === 'ingest.questions') {
        return {
          text: JSON.stringify({ fill: [{ prompt: '___ 是什麼?', answers: [['答案']] }, { prompt: '___ 呢?', answers: [['另一個']] }], apply: [{ prompt: '應用題', rubric: ['一', '二'] }] }),
          provider: 'anthropic',
          model: 'test',
          latency_ms: 1,
          provisional: false,
        };
      }
      s.prompts.push(prompt);
      n += 1;
      const children = [{ title: `第${n}個父卡的子卡`, body: `第${n}個父卡的子卡講的事。`, examples: [] }];
      return { text: JSON.stringify(children), provider: 'anthropic', model: 'test', latency_ms: 1, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function header(prompt: string): string[] {
  const lines = prompt.split('\n');
  const first = lines.indexOf('---');
  const second = lines.indexOf('---', first + 1);
  assert.ok(first >= 0 && second > first, `prompt 沒有 --- 夾住的 header:\n${prompt}`);
  return lines.slice(first + 1, second);
}

function listed(prompt: string): string[] {
  return header(prompt).filter((l) => l.startsWith('- '));
}

// ---------------------------------------------------------------- Given

Given('a category with four cards, one of them the parent', function (this: LearningWorld) {
  const s = newState(this);
  for (const id of ['sec-0002', 'sec-0003', 'sec-0004']) addOther(s, id);
});

Given('a category whose only card is the parent', function (this: LearningWorld) {
  newState(this);
});

Given('the category also holds a short version file and a card file that cannot be parsed', function (this: LearningWorld) {
  const s = newState(this);
  addOther(s, 'sec-0002'); // 一張正常的,讓區塊存在
  // 縮短版的 frontmatter 完整合法:要靠檔名排除,不是靠解析失敗剛好略過
  writeFileSync(join(s.root, 'cards', CATEGORY, 'sec-0002.short.md'), `---\nid: sec-0002\ncategory: security\ntitle: 縮短版不該被列出來\nlevel: 0\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/security/x.md#L1-L2\nprereqs: []\n---\n\n縮短版不該被列出來。\n`, 'utf8');
  writeFileSync(join(s.root, 'cards', CATEGORY, 'sec-0009.md'), '---\nid: [壞掉的\n---\n\n讀不出來的卡。\n', 'utf8');
});

Given('another category holds a card of its own', function (this: LearningWorld) {
  putCard(st(this).root, makeCard('net-0001', '別的分類的卡', '別的分類的內容。', 'network'));
});

Given('a category with one hundred cards besides the parent', function (this: LearningWorld) {
  const s = newState(this);
  for (let n = 2; n <= 101; n += 1) addOther(s, `sec-${String(n).padStart(4, '0')}`);
});

Given('two parents in the same category', function (this: LearningWorld) {
  const s = newState(this);
  const second = makeCard('sec-0002', '第二個父卡', '第二個父卡的內文。');
  putCard(s.root, second);
  s.parents = [s.parent, second];
});

// ---------------------------------------------------------------- When

When('children are generated for the parent', async function (this: LearningWorld) {
  const s = st(this);
  await generateChildren(s.parent, recordingRouter(s), { outDir: s.root, today: '2026-10-17' });
});

When('children are generated for both parents in turn', async function (this: LearningWorld) {
  const s = st(this);
  await generateChildrenForCards(s.parents, recordingRouter(s), { outDir: s.root, today: '2026-10-17' });
});

// ---------------------------------------------------------------- Then

Then('the prompt carries an already-covered block before the parent body', function (this: LearningWorld) {
  const s = st(this);
  const h = header(s.prompts[0]!);
  const at = h.indexOf('already_covered:');
  assert.ok(at >= 0, `header 裡沒有 already_covered::\n${s.prompts[0]}`);
  assert.ok(at > h.indexOf(`parent_title: ${s.parent.frontmatter.title}`), 'already_covered 要在 parent_title 之後');
  assert.ok(s.prompts[0]!.endsWith(`\n---\n${s.parent.body}`), '父卡 body 要在結尾的 --- 之後');
});

Then('the block lists the other three cards, each with its title and the first sentence of its body', function (this: LearningWorld) {
  const s = st(this);
  assert.deepEqual(listed(s.prompts[0]!), s.others.map((o) => `- ${o.title}:${o.summary}`));
});

Then('the prompt carries no already-covered block', function (this: LearningWorld) {
  // 模板 children.md 本身就提到 already_covered(說明那個區塊),所以只看 header 裡有沒有那一行
  const h = header(st(this).prompts[0]!);
  assert.ok(!h.includes('already_covered:'), `header 不該有 already_covered::\n${h.join('\n')}`);
  assert.ok(!h.some((l) => l.startsWith('- ')), `header 不該列任何卡:\n${h.join('\n')}`);
});

Then('the prompt is the same as the one built from the parent alone', function (this: LearningWorld) {
  const s = st(this);
  const p = s.parent;
  const expected = [loadPromptTemplate('children'), '---', `parent_id: ${p.frontmatter.id}`, `parent_title: ${p.frontmatter.title}`, '---', p.body].join('\n');
  assert.equal(s.prompts[0], expected);
});

Then('the block lists none of those three', function (this: LearningWorld) {
  const s = st(this);
  const lines = listed(s.prompts[0]!);
  assert.deepEqual(lines, s.others.map((o) => `- ${o.title}:${o.summary}`), `只該列正常的那一張:\n${lines.join('\n')}`);
  assert.ok(!s.prompts[0]!.includes('縮短版不該被列出來'));
  assert.ok(!s.prompts[0]!.includes('別的分類的卡'));
  assert.ok(!s.prompts[0]!.includes('讀不出來的卡'));
});

Then('the block does not list the parent itself', function (this: LearningWorld) {
  const s = st(this);
  assert.ok(!listed(s.prompts[0]!).some((l) => l.startsWith(`- ${s.parent.frontmatter.title}:`)));
});

Then('the block lists exactly eighty cards', function (this: LearningWorld) {
  assert.equal(listed(st(this).prompts[0]!).length, 80);
});

Then('they are the eighty with the highest ids, in ascending id order', function (this: LearningWorld) {
  const s = st(this);
  const expected = s.others.slice(-80).map((o) => `- ${o.title}:${o.summary}`);
  assert.deepEqual(listed(s.prompts[0]!), expected);
});

Then('the prompt for the second parent lists the children written for the first', function (this: LearningWorld) {
  const s = st(this);
  assert.equal(s.prompts.length, 2);
  assert.ok(listed(s.prompts[1]!).includes('- 第1個父卡的子卡:第1個父卡的子卡講的事。'), `第二個父卡的 prompt 看不到第一個父卡剛寫的子卡:\n${s.prompts[1]}`);
  assert.ok(!listed(s.prompts[0]!).some((l) => l.includes('第1個父卡的子卡')), '第一個父卡不該看到自己還沒寫的子卡');
});
