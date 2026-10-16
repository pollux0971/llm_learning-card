/**
 * T18 (b)(c):`generateChildren` 送給 router 的 prompt 帶 `already_covered:`;`generateChildrenForCards`
 * 每個父卡都重新讀磁碟,第二個父卡看得到第一個父卡剛寫進去的子卡。
 *
 * 規格:`docs/tickets/T18-children-sees-sibling-cards.md` 的 (b)(c);場景層是 `features/02-ingest-pipeline/phase-4.feature`。
 * 假 router 記下每一次的 prompt,不呼叫真的 LLM;一律暫存目錄。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/llm/index.js';
import { generateChildren, generateChildrenForCards, type ChildCandidate } from './children.js';
import { loadPromptTemplate } from './prompts.js';

const CATEGORY = 'security';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function outDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-t18-children-'));
  dirs.push(d);
  return d;
}

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

/** 照 children.ts 的寫檔格式放一張卡(frontmatter + 空行 + body)。 */
function putCard(root: string, card: Card): void {
  const dir = join(root, 'cards', card.frontmatter.category);
  mkdirSync(dir, { recursive: true });
  const fm = card.frontmatter;
  writeFileSync(
    join(dir, `${fm.id}.md`),
    `---\nid: ${fm.id}\ncategory: ${fm.category}\ntitle: ${fm.title}\nlevel: ${fm.level}\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/${fm.category}/x.md#L1-L2\nprereqs: []\n---\n\n${card.body}\n`,
    'utf8',
  );
}

function router(responses: ChildCandidate[][]): { router: LlmRouter; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  const r: LlmRouter = {
    async call(task, prompt): Promise<LlmResult> {
      if (task === 'ingest.questions') {
        // 子卡考題不是這張工單的事;給一個合法回應讓流程走完
        return {
          text: JSON.stringify({ fill: [{ prompt: '___ 是什麼?', answers: [['答案']] }, { prompt: '___ 呢?', answers: [['另一個']] }], apply: [{ prompt: '應用題', rubric: ['一', '二'] }] }),
          provider: 'anthropic',
          model: 'test',
          latency_ms: 1,
          provisional: false,
        };
      }
      prompts.push(prompt);
      const next = responses[i];
      i += 1;
      if (!next) throw new Error(`沒有第 ${i} 次 ingest.cards 的回應`);
      return { text: JSON.stringify(next), provider: 'anthropic', model: 'test', latency_ms: 1, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router: r, prompts };
}

const child = (title: string): ChildCandidate => ({ title, body: `${title}的細節。`, examples: [] });

/** T12 之後(T18 之前)的 prompt:模板、`---`、parent_id、parent_title、`---`、body。 */
function t12Prompt(parent: Card): string {
  return [loadPromptTemplate('children'), '---', `parent_id: ${parent.frontmatter.id}`, `parent_title: ${parent.frontmatter.title}`, '---', parent.body].join('\n');
}

/** header 區塊(template 之後的第一個 `---` 到第二個 `---` 之間)的行。 */
function headerLines(prompt: string): string[] {
  const lines = prompt.split('\n');
  const first = lines.indexOf('---');
  const second = lines.indexOf('---', first + 1);
  expect(first, '找不到 header 開頭的 ---').toBeGreaterThanOrEqual(0);
  expect(second, '找不到 header 結尾的 ---').toBeGreaterThan(first);
  return lines.slice(first + 1, second);
}

describe('generateChildren 的 prompt(T18 (b)):同分類有別的卡時帶 already_covered', () => {
  it('四張卡(含父卡)→ header 裡 parent_title 之後、結尾 --- 之前有 already_covered,其他三張依 id 一行一張', async () => {
    const root = outDir();
    const parent = makeCard('sec-0002', '父卡', '父卡的內文。');
    putCard(root, makeCard('sec-0001', '一號卡', '一號卡講的第一件事。第二句不出現。'));
    putCard(root, parent);
    putCard(root, makeCard('sec-0003', '三號卡', '三號卡講的第一件事!後面。'));
    putCard(root, makeCard('sec-0004', '四號卡', '沒有句號的四號卡'));
    const { router: r, prompts } = router([[child('子一')]]);

    await generateChildren(parent, r, { outDir: root });

    expect(prompts).toHaveLength(1);
    expect(headerLines(prompts[0]!)).toEqual([
      'parent_id: sec-0002',
      'parent_title: 父卡',
      'already_covered:',
      '- 一號卡:一號卡講的第一件事。',
      '- 三號卡:三號卡講的第一件事!',
      '- 四號卡:沒有句號的四號卡',
    ]);
    expect(prompts[0]!.startsWith(loadPromptTemplate('children'))).toBe(true);
    expect(prompts[0]!.endsWith('\n---\n父卡的內文。')).toBe(true);
    expect(prompts[0]!.split('\n').filter((l) => l === '---')).toHaveLength(2);
  });

  it('分類裡只有父卡 → 沒有 already_covered,prompt 跟 T12 之後的版本逐字相同', async () => {
    const root = outDir();
    const parent = makeCard('sec-0001', '唯一的卡', '只有自己。');
    putCard(root, parent);
    const { router: r, prompts } = router([[child('子一')]]);
    await generateChildren(parent, r, { outDir: root });
    expect(prompts[0]).toBe(t12Prompt(parent));
    // 模板 children.md 本身就提到 already_covered(說明那個區塊),所以只看 header 裡有沒有那一行
    expect(headerLines(prompts[0]!)).not.toContain('already_covered:');
  });

  it('分類資料夾還不存在(父卡沒寫進磁碟)也照 T12 版本送,不丟錯', async () => {
    const root = outDir();
    const parent = makeCard('sec-0001', '還沒寫檔的父卡', '內文。');
    const { router: r, prompts } = router([[child('子一')]]);
    await generateChildren(parent, r, { outDir: root });
    expect(prompts[0]).toBe(t12Prompt(parent));
  });

  it('不列父卡自己、.short.md、讀不出來的卡檔、別的分類的卡', async () => {
    const root = outDir();
    const parent = makeCard('sec-0001', '父卡', '父卡的內文。');
    putCard(root, parent);
    putCard(root, makeCard('sec-0002', '正常的兄弟卡', '正常的兄弟卡。'));
    // 縮短版的 frontmatter 完整合法:要靠檔名排除,不是靠解析失敗剛好略過
    writeFileSync(join(root, 'cards', CATEGORY, 'sec-0002.short.md'), `---\nid: sec-0002\ncategory: security\ntitle: 縮短版不該被列\nlevel: 0\nsource: raw\ncreated: 2026-09-01\nsource_ref: raw/security/x.md#L1-L2\nprereqs: []\n---\n\n縮短版不該被列。\n`, 'utf8');
    writeFileSync(join(root, 'cards', CATEGORY, 'sec-0009.md'), '---\nid: [壞掉\n---\n\n讀不出來。\n', 'utf8');
    putCard(root, makeCard('net-0001', '別的分類的卡', '別的分類。', 'network'));
    const { router: r, prompts } = router([[child('子一')]]);

    await generateChildren(parent, r, { outDir: root });

    expect(headerLines(prompts[0]!).filter((l) => l.startsWith('- '))).toEqual(['- 正常的兄弟卡:正常的兄弟卡。']);
    expect(prompts[0]).not.toContain('縮短版不該被列');
    expect(prompts[0]).not.toContain('別的分類的卡');
  });

  it('一百張兄弟卡 → 剛好列 80 張,是 id 最大的 80 張,依 id 遞增', async () => {
    const root = outDir();
    const parent = makeCard('sec-0001', '父卡', '父卡的內文。');
    putCard(root, parent);
    for (let n = 2; n <= 101; n += 1) {
      const id = `sec-${String(n).padStart(4, '0')}`;
      putCard(root, makeCard(id, `卡${id}`, `${id} 的第一句。`));
    }
    const { router: r, prompts } = router([[child('子一')]]);
    await generateChildren(parent, r, { outDir: root });
    const listed = headerLines(prompts[0]!).filter((l) => l.startsWith('- '));
    expect(listed).toHaveLength(80);
    expect(listed[0]).toBe('- 卡sec-0022:sec-0022 的第一句。');
    expect(listed[79]).toBe('- 卡sec-0101:sec-0101 的第一句。');
  });

  it('每次呼叫都重新讀磁碟(不是模組載入時讀一次)', async () => {
    const root = outDir();
    const parent = makeCard('sec-0001', '父卡', '父卡的內文。');
    putCard(root, parent);
    const { router: r, prompts } = router([[child('子一')], [child('子二')]]);
    await generateChildren(parent, r, { outDir: root });
    putCard(root, makeCard('sec-0005', '後來才寫的卡', '後來才寫的。'));
    await generateChildren(parent, r, { outDir: root });
    expect(prompts[0]).not.toContain('後來才寫的卡');
    expect(headerLines(prompts[1]!)).toContain('- 後來才寫的卡:後來才寫的。');
  });
});

describe('generateChildrenForCards(T18 (c)):第二個父卡看得到第一個父卡剛寫的子卡', () => {
  it('兩個父卡依序:第二個的 already_covered 有第一個父卡的子卡標題;第一個看得到第二個父卡但看不到自己的子卡(還沒寫)', async () => {
    const root = outDir();
    const first = makeCard('sec-0001', '第一個父卡', '第一個父卡的內文。');
    const second = makeCard('sec-0002', '第二個父卡', '第二個父卡的內文。');
    putCard(root, first);
    putCard(root, second);
    const { router: r, prompts } = router([[child('第一個父卡的子卡甲'), child('第一個父卡的子卡乙')], [child('第二個父卡的子卡')]]);

    const result = await generateChildrenForCards([first, second], r, { outDir: root, today: '2026-10-17' });

    expect(result.children).toHaveLength(3);
    expect(prompts).toHaveLength(2);
    const firstListed = headerLines(prompts[0]!).filter((l) => l.startsWith('- '));
    expect(firstListed).toEqual(['- 第二個父卡:第二個父卡的內文。']);
    const secondListed = headerLines(prompts[1]!).filter((l) => l.startsWith('- '));
    expect(secondListed).toContain('- 第一個父卡:第一個父卡的內文。');
    expect(secondListed).toContain('- 第一個父卡的子卡甲:第一個父卡的子卡甲的細節。');
    expect(secondListed).toContain('- 第一個父卡的子卡乙:第一個父卡的子卡乙的細節。');
    expect(secondListed.some((l) => l.includes('第二個父卡:'))).toBe(false);
  });
});
