/**
 * T25:連錯兩次的卡沒有縮短版(`<id>.short.md`)時,presentNextCard 退回原卡,不丟錯。
 *
 * 現況:reteachQueue 有卡 → loadCardBody(short:true) → findCardFile 找不到就 throw,
 * 終端機複習整個停掉。工單:docs/tickets/T25-reteach-missing-short-card.md。
 *
 * 退回:回 { kind: 'reteach', card, shortBody: 原卡 body, usedOriginal: true };縮短版存在時回傳逐位元不變、
 * 沒有 usedOriginal 這個鍵。記一筆 warning(reason 'short-card-missing',欄位只有 ts/type/card/reason)。
 * 原卡也不存在、或縮短版存在但壞掉 → 照舊丟錯(不吞)。
 *
 * 全部用暫存目錄;不碰真的 learning/。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LlmRouter } from '@core/grading/index.js';
import { presentNextCard } from './present.js';
import type { Session } from './types.js';

const TODAY = '2026-09-10';
const FULL_BODY = '完整版第一句。完整版第二句。';
const FENCE_MARK = '範例圍欄內容不該出現';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function noopRouter(): LlmRouter {
  return {
    async call() {
      throw new Error('presentNextCard 不應該呼叫 router');
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-t25-'));
  tmpDirs.push(dir);
  // 真的 learning 目錄一定有 state/(index 時就建好);測試目錄照樣,才不會把「要不要 mkdir」變成這張工單的規格
  mkdirSync(join(dir, 'state'), { recursive: true });
  return dir;
}

const FRONT = (id: string, category: string): string =>
  `---\nid: ${id}\ncategory: ${category}\ntitle: ${id}\nlevel: 0\nsource: raw\nsource_ref: raw/${category}/x.md#L1-L2\ncreated: 2026-09-01\n---\n`;

function writeOriginal(dir: string, id: string, body = FULL_BODY, category = 'security'): void {
  mkdirSync(join(dir, 'cards', category), { recursive: true });
  writeFileSync(join(dir, 'cards', category, `${id}.md`), `${FRONT(id, category)}${body}\n\n\`\`\`example\n${FENCE_MARK}\n\`\`\`\n`);
}

function writeShort(dir: string, id: string, body = '縮短版內容。', category = 'security'): void {
  mkdirSync(join(dir, 'cards', category), { recursive: true });
  writeFileSync(
    join(dir, 'cards', category, `${id}.short.md`),
    `---\nid: ${id}\ncategory: ${category}\ntitle: ${id}\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n${body}\n`,
  );
}

function writeQuestions(dir: string, id: string): void {
  mkdirSync(join(dir, 'questions'), { recursive: true });
  writeFileSync(
    join(dir, 'questions', `${id}.yaml`),
    [`card: ${id}`, 'fill:', '  - prompt: "答案是 ___。"', '    answers:', '      - ["對"]', '  - prompt: "另一個 ___。"', '    answers:', '      - ["也對"]', 'apply:', '  - prompt: "解釋一下。"', '    rubric:', '      - "有講到重點"', '      - "沒有事實錯誤"', ''].join('\n'),
  );
}

function makeSession(dir: string, over: Partial<Session> = {}): Session {
  return {
    learningDir: dir,
    today: TODAY,
    dailyCap: 10,
    router: noopRouter(),
    queue: [],
    reteachQueue: [],
    totalDue: 0,
    deferred: 0,
    passed: 0,
    failed: 0,
    errors: 0,
    ...over,
  };
}

const item = (card: string) => ({ card, stage: 1 as const, types: ['fill' as const], overdue_days: 0, overdue_ratio: 0, stuck: false });

function warningLines(dir: string): Record<string, unknown>[] {
  const path = join(dir, 'state/log.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full.slice(root.length + 1));
    }
  };
  walk(root);
  return out.sort();
}

describe('縮短版缺檔 → 退回原卡', () => {
  it('不丟錯,回原卡 body(不含 frontmatter 與 example 圍欄),shortBody 之外多一個 usedOriginal: true', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0001');
    const session = makeSession(dir, { reteachQueue: ['sec-0001'], queue: [item('sec-0001')], totalDue: 1 });
    const result = await presentNextCard(session);
    expect(result).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: FULL_BODY, usedOriginal: true });
    const body = (result as { shortBody: string }).shortBody;
    expect(body).not.toContain(FENCE_MARK);
    expect(body).not.toContain('source_ref');
    expect(body).not.toContain('---');
  });

  it('原卡放在別的分類資料夾也找得到(跟 findCardFile 一樣掃全部分類)', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'net-0001', '網路的完整版內容。', 'networking');
    const session = makeSession(dir, { reteachQueue: ['net-0001'] });
    expect(await presentNextCard(session)).toEqual({ kind: 'reteach', card: 'net-0001', shortBody: '網路的完整版內容。', usedOriginal: true });
  });

  it('退回時 reteachQueue 照常被消耗,其他狀態都不動(session.current、queue、totalDue、passed/failed/errors),下一次照常出第一題', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0001');
    const session = makeSession(dir, { reteachQueue: ['sec-0001'], queue: [item('sec-0001')], totalDue: 1, passed: 2, failed: 1, errors: 1, deferred: 3 });
    await presentNextCard(session);
    expect(session.reteachQueue).toEqual([]);
    expect(session.current).toBeUndefined();
    expect(session.queue).toHaveLength(1);
    expect(session.totalDue).toBe(1);
    expect([session.passed, session.failed, session.errors, session.deferred]).toEqual([2, 1, 1, 3]);
    const question = await presentNextCard(session);
    expect(question).toMatchObject({ kind: 'question', card: 'sec-0001', progress: { index: 1, total: 1 } });
  });

  it('兩張缺縮短版的卡:各退回各的原卡、各記一筆(每卡一筆),之後呈現題目不再多記', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001', '第一張原卡。');
    writeOriginal(dir, 'sec-0002', '第二張原卡。');
    writeQuestions(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0002');
    const session = makeSession(dir, { reteachQueue: ['sec-0001', 'sec-0002'], queue: [item('sec-0001'), item('sec-0002')], totalDue: 2 });
    const a = await presentNextCard(session);
    const b = await presentNextCard(session);
    await presentNextCard(session); // 第一題
    expect(a).toMatchObject({ card: 'sec-0001', shortBody: '第一張原卡。', usedOriginal: true });
    expect(b).toMatchObject({ card: 'sec-0002', shortBody: '第二張原卡。', usedOriginal: true });
    expect(warningLines(dir).map((e) => e.card)).toEqual(['sec-0001', 'sec-0002']);
  });

  it('不在 learning/ 底下新增縮短版或別的東西;除了 state/log.jsonl 之外沒有新檔', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    writeQuestions(dir, 'sec-0001');
    const before = tree(dir);
    await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
    const added = tree(dir).filter((f) => !before.includes(f));
    expect(added).toEqual(['state/log.jsonl']);
    expect(tree(dir).filter((f) => f.endsWith('.short.md'))).toEqual([]);
  });
});

describe('warning', () => {
  it('剛好一行:type warning、reason short-card-missing、card 是該卡、ts 是 ISO;欄位只有這四個;沒有絕對路徑、沒有卡片內容', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
    const raw = readFileSync(join(dir, 'state/log.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    const event = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(['card', 'reason', 'ts', 'type']);
    expect(event.type).toBe('warning');
    expect(event.reason).toBe('short-card-missing');
    expect(event.card).toBe('sec-0001');
    expect(new Date(event.ts as string).toISOString()).toBe(event.ts);
    expect(raw).not.toContain(dir);
    expect(raw).not.toContain('完整版');
    expect(raw).not.toContain(FENCE_MARK);
  });

  it('已有的 log 內容不動,warning 接在後面', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    const existing = `${JSON.stringify({ ts: '2026-09-09T00:00:00.000Z', type: 'reviewed', card: 'sec-0009' })}\n`;
    writeFileSync(join(dir, 'state/log.jsonl'), existing);
    await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
    const raw = readFileSync(join(dir, 'state/log.jsonl'), 'utf8');
    expect(raw.startsWith(existing)).toBe(true);
    expect(raw.slice(existing.length).trim().split('\n')).toHaveLength(1);
  });

  it('log 寫不進去(log.jsonl 是個目錄)也不可以讓複習停掉,還是回原卡', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    mkdirSync(join(dir, 'state/log.jsonl'), { recursive: true });
    const result = await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
    expect(result).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: FULL_BODY, usedOriginal: true });
  });

  it.skipIf(process.getuid?.() === 0)('state 目錄唯讀也不可以讓複習停掉', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    chmodSync(join(dir, 'state'), 0o500);
    try {
      const result = await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
      expect(result).toMatchObject({ kind: 'reteach', card: 'sec-0001', usedOriginal: true });
    } finally {
      chmodSync(join(dir, 'state'), 0o700);
    }
  });
});

describe('縮短版存在 → 行為與現況逐位元相同', () => {
  it('回傳 toEqual 縮短版內容,而且沒有 usedOriginal 這個鍵;沒有 warning、沒有 log 檔', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    writeShort(dir, 'sec-0001', '縮短版內容。');
    const result = await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }));
    expect(result).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: '縮短版內容。' });
    expect(Object.keys(result)).toEqual(['kind', 'card', 'shortBody']);
    expect('usedOriginal' in result).toBe(false);
    expect(existsSync(join(dir, 'state/log.jsonl'))).toBe(false);
  });

  it('只有縮短版、沒有原卡也照現況回縮短版(不去讀原卡)', async () => {
    const dir = makeDir();
    writeShort(dir, 'sec-0001', '只有縮短版。');
    expect(await presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }))).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: '只有縮短版。' });
  });
});

describe('真的壞掉的照舊丟錯(不吞)', () => {
  it('縮短版和原卡都不存在 → 丟錯(找不到卡片檔案,訊息含卡片 id),不吞', async () => {
    const dir = makeDir();
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    await expect(presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }))).rejects.toThrow(/找不到卡片檔案.*sec-0001/);
  });

  it('縮短版存在但壞掉(frontmatter 沒有結尾)→ 丟錯,沒有退回原卡、沒有 warning', async () => {
    const dir = makeDir();
    writeOriginal(dir, 'sec-0001');
    mkdirSync(join(dir, 'cards/security'), { recursive: true });
    writeFileSync(join(dir, 'cards/security/sec-0001.short.md'), '---\nid: sec-0001\ncategory: security\n縮短版沒有結尾的 frontmatter\n');
    await expect(presentNextCard(makeSession(dir, { reteachQueue: ['sec-0001'] }))).rejects.toThrow();
    expect(warningLines(dir)).toEqual([]);
  });
});
