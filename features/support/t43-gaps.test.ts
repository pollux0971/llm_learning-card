/**
 * T43(07 phase-3)驗收補洞 G1–G3(`docs/reviews/acceptance-T43.md`;顧問裁 A)。
 * 測試 agent 寫;開發 worker 不改。只加測試、不改實作。
 *
 *   G1  commitDeepen 寫檔前的 validateCard 閘門(CLAUDE.md 硬規則 3:教學卡 body ≤100 字,程式硬檢查):
 *       手造一張超字(或格式壞)的 PreparedCard,commitDeepen 必須回 { ok: false },而且整棵 learning 暫存樹前後一個位元組都沒變;
 *       session 層(generateDeepen 被換成回這張卡)poll 回 deepen-failed。
 *       注意:commitDeepen 驗證失敗回的 kind 現況是 'collision'(名字不準,呼叫端一律轉 deepen-failed)——這裡照現況斷言,不改實作。
 *   G2  teach-deepen 的 failJob 要先問 isCurrent:舊工作被取消之後才丟出非預期例外,不能污染新工作(不留 pending 錯誤、新工作照常完成)。
 *   G3  生成途中的三條錯誤分流:
 *       (1) 字數重寫呼叫丟憑證錯誤 → 整個中止(credential-unavailable),磁碟沒變;
 *       (2) 字數重寫呼叫丟 NoModelError → 只略過那一張(skipped +1),其他卡照寫;
 *       (3) 考題呼叫丟憑證錯誤 → 整個中止,不是略過。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingCredentialError, NoModelError } from '../../packages/core/src/llm/errors.js';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import {
  LONG_BODY,
  PARENT,
  SHORT_BODY,
  VALID_QUESTIONS,
  cardText,
  cleanupRigs,
  deepRig,
  diskHashes,
  errorKind,
  errorMessage,
  logEvents,
  questionFiles,
  cardFiles,
  resultOf,
  type Candidate,
} from './t43-harness.js';

// 每條都真的起檔案,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

type GenerateArgs = Record<string, unknown>;
type Generate = (args: GenerateArgs) => Promise<unknown>;

const control = vi.hoisted(() => ({ override: undefined as undefined | ((args: Record<string, unknown>) => Promise<unknown>) }));

// generateDeepen 預設照跑真的;要偽造「生成的結果」或「生成途中丟例外」的測試把 control.override 換掉(每條測試後還原)
vi.mock('../../packages/core/src/ingest/deepen.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../packages/core/src/ingest/deepen.js')>();
  return {
    ...real,
    generateDeepen: (args: Record<string, unknown>): Promise<unknown> =>
      control.override === undefined ? real.generateDeepen(args as never) : control.override(args),
  };
});

import { commitDeepen, type PreparedCard } from '../../packages/core/src/ingest/deepen.js';

afterAll(cleanupRigs);
beforeEach(() => {
  control.override = undefined;
});
afterEach(() => {
  control.override = undefined;
});

// 真的 generateDeepen(不經過上面的替換)
const realGenerate: Generate = async (args) => {
  const real = await vi.importActual<typeof import('../../packages/core/src/ingest/deepen.js')>('../../packages/core/src/ingest/deepen.ts');
  return real.generateDeepen(args as never);
};

// ---------------------------------------------------------------- 工具

/** 整棵樹:每個檔與每個目錄(相對路徑)+ 檔案內容雜湊;目錄記成 `<dir>/`。包含 state/log.jsonl。 */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      if (statSync(full).isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(full);
      } else {
        out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

function prepared(id: string, body: string, opts: { breakFrontmatter?: boolean } = {}): PreparedCard {
  const text = cardText({ id, category: 'security', title: `手造卡${id}`, level: 2, parent: PARENT, prereqs: [PARENT], source: 'llm' }, body);
  const parsed = parseCardText(text);
  const frontmatter = { ...parsed.frontmatter, provisional: false } as Record<string, unknown>;
  // 格式壞:level 不是 0..4 的整數(validateCard 不過)
  if (opts.breakFrontmatter) frontmatter['level'] = 'deep';
  return {
    card: { frontmatter, body: parsed.body, examples: parsed.examples } as never,
    questions: { card: id, ...VALID_QUESTIONS } as never,
    provisional: false,
  };
}

const kids = (long: string[], count = 2): Candidate[] =>
  Array.from({ length: count }, (_, i) => ({ title: `新卡${i + 1}`, body: long.includes(`新卡${i + 1}`) ? LONG_BODY : `${SHORT_BODY}(${i + 1})`, examples: [] }));

const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];

// ---------------------------------------------------------------- G1

describe('G1:commitDeepen 寫檔前的 validateCard 閘門(硬規則 3)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('對照組:格式正確的手造卡 → ok:true,而且真的寫了卡檔、考題檔、deepened(證明下面的紅不是手造卡本身壞了)', () => {
    const dir = mkdtempSync(join(tmpdir(), 't43-g1-'));
    dirs.push(dir);
    const res = commitDeepen({ learningDir: dir, parentId: PARENT, category: 'security', cards: [prepared('sec-0004', SHORT_BODY)], skipped: 0 });
    expect(res).toEqual({ ok: true, ids: ['sec-0004'] });
    expect(existsSync(join(dir, 'cards/security/sec-0004.md'))).toBe(true);
    expect(existsSync(join(dir, 'questions/sec-0004.yaml'))).toBe(true);
  });

  it('body 101 個詞:回 { ok: false };空的 learning 目錄之後仍然是空的(沒新卡檔、沒考題檔、沒圖、沒 log、沒建任何目錄)', () => {
    const dir = mkdtempSync(join(tmpdir(), 't43-g1-'));
    dirs.push(dir);
    const before = tree(dir);
    const res = commitDeepen({ learningDir: dir, parentId: PARENT, category: 'security', cards: [prepared('sec-0004', LONG_BODY)], skipped: 0 });
    // 現況:驗證失敗回的 kind 是 'collision'(名字不準);呼叫端一律把 ok:false 轉成 deepen-failed,所以這裡只釘 ok:false 與現況 kind,不要求改名
    expect(res).toEqual({ ok: false, kind: 'collision' });
    expect(tree(dir)).toEqual(before);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('兩張裡只有第二張超字:整批都不寫(第一張合格的也不能先落地);有內容的世界整棵樹前後逐位元組相同', async () => {
    const r = await deepRig();
    const before = tree(r.v.dir);
    const res = commitDeepen({
      learningDir: r.v.dir,
      parentId: PARENT,
      category: 'security',
      cards: [prepared('sec-0004', SHORT_BODY), prepared('sec-0005', LONG_BODY)],
      skipped: 0,
    });
    expect(res).toMatchObject({ ok: false });
    expect(tree(r.v.dir), '含 state/log.jsonl:沒有 deepened,也沒有 warning').toEqual(before);
    expect(cardFiles(r.v).filter((id) => !BASE.includes(id))).toEqual([]);
    expect(questionFiles(r.v).filter((id) => !BASE.includes(id))).toEqual([]);
    expect(logEvents(r.v, 'deepened')).toHaveLength(0);
  });

  it('body 剛好 100 個詞可以寫、101 個不行(閘門的邊界跟契約 §2 一樣)', async () => {
    const { EXACT_BODY } = await import('./t43-harness.js');
    const ok = mkdtempSync(join(tmpdir(), 't43-g1-'));
    dirs.push(ok);
    expect(commitDeepen({ learningDir: ok, parentId: PARENT, category: 'security', cards: [prepared('sec-0004', EXACT_BODY)], skipped: 0 })).toMatchObject({ ok: true });
  });

  it('其他 validateCard 不過的格式(frontmatter 的 level 不是整數)一樣不寫', () => {
    const dir = mkdtempSync(join(tmpdir(), 't43-g1-'));
    dirs.push(dir);
    const res = commitDeepen({ learningDir: dir, parentId: PARENT, category: 'security', cards: [prepared('sec-0004', SHORT_BODY, { breakFrontmatter: true })], skipped: 0 });
    expect(res).toMatchObject({ ok: false });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('session 層:生成結果裡有一張超字卡 → poll 回 deepen-failed + 固定字樣;磁碟一個位元組沒變;沒有 deepened;畫面還是原本那張', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = tree(r.v.dir);
    const hashes = diskHashes(r.v);
    control.override = async () => ({ kind: 'cards', cards: [prepared('sec-0004', SHORT_BODY), prepared('sec-0005', LONG_BODY)], skipped: 0 });
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('deepen-failed');
    expect(errorMessage(done)).toBe('這次沒有產生出能用的卡。可以再按一次「深入這個」。');
    expect(tree(r.v.dir)).toEqual(before);
    expect(diskHashes(r.v)).toEqual(hashes);
    expect(logEvents(r.v, 'deepened')).toHaveLength(0);
    const after = await r.view('teach.poll');
    expect(after.generating).toBe(false);
    expect(after.card?.id).toBe(PARENT);
    expect(after.from).toBeNull();
  });

  it('session 層對照組:同一條路,卡格式正確 → 寫入並進到新卡(證明上面的 deepen-failed 是閘門擋的,不是這條路本來就壞)', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    control.override = async () => ({ kind: 'cards', cards: [prepared('sec-0004', SHORT_BODY)], skipped: 0 });
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(resultOf(done).card?.id).toBe('sec-0004');
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- G2

describe('G2:舊工作被取消之後才丟非預期例外,不影響新工作(failJob 的 isCurrent)', () => {
  const nap = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('取消工作 1、開工作 2,之後工作 1 才丟例外:poll 沒有錯誤、工作 2 照常完成並進到新卡', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    let release1!: () => void;
    const gate1 = new Promise<void>((resolve) => {
      release1 = resolve;
    });
    let release2!: () => void;
    const gate2 = new Promise<void>((resolve) => {
      release2 = resolve;
    });
    let n = 0;
    control.override = async (args) => {
      n += 1;
      if (n === 1) {
        await gate1;
        throw new Error('非預期的例外(工作 1)');
      }
      await gate2;
      return realGenerate(args);
    };
    const first = await r.view('teach.deepen');
    expect(first.generating).toBe(true);
    const cancelled = await r.view('teach.cancel');
    expect(cancelled.generating).toBe(false);
    const second = await r.view('teach.deepen');
    expect(second.generating).toBe(true);
    expect(n, '工作 2 真的是另一個工作').toBe(2);

    release1();
    await nap(60);
    const mid = await r.send('teach.poll');
    expect(mid['ok'], `舊工作的例外不能變成新工作的錯誤:${JSON.stringify(mid)}`).toBe(true);
    expect(resultOf(mid).generating, '新工作還在跑,不能被舊工作的失敗改成沒在跑').toBe(true);

    release2();
    const done = await r.pollDone();
    expect(done['ok'], `新工作應該照常完成,不是回舊工作的錯:${JSON.stringify(done)}`).toBe(true);
    const view = resultOf(done);
    expect(view.generating).toBe(false);
    expect(view.card?.id).toBe('sec-0004');
    expect(view.from?.id).toBe(PARENT);
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
    // 之後再 poll 也不會冒出舊錯
    const later = await r.send('teach.poll');
    expect(later['ok']).toBe(true);
  });

  it('舊工作先丟例外、新工作還沒開之前就已經被取消:之後開新工作,poll 一樣乾淨', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    let release1!: () => void;
    const gate1 = new Promise<void>((resolve) => {
      release1 = resolve;
    });
    let n = 0;
    control.override = async (args) => {
      n += 1;
      if (n === 1) {
        await gate1;
        throw new Error('非預期的例外(工作 1)');
      }
      return realGenerate(args);
    };
    await r.view('teach.deepen');
    await r.view('teach.cancel');
    release1();
    await nap(60);
    const idle = await r.send('teach.poll');
    expect(idle['ok'], JSON.stringify(idle)).toBe(true);
    expect(resultOf(idle).generating).toBe(false);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(resultOf(done).card?.id).toBe('sec-0004');
  });
});

// ---------------------------------------------------------------- G3

describe('G3:生成途中的錯誤分流(字數重寫、考題)', () => {
  const cred = new MissingCredentialError('OPENAI_API_KEY');
  const CRED_TEXT = '產生新卡要用的金鑰沒有設定:OPENAI_API_KEY。請在專案根目錄的 .env 加上。';

  it('(1) 字數重寫呼叫丟憑證錯誤:整個中止,回 credential-unavailable + 深入字樣;第一張合格的也不寫;磁碟沒變', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => kids(['新卡2']);
        router.regenerate = () => cred;
      },
    });
    await r.view('teach.open');
    const before = tree(r.v.dir);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('credential-unavailable');
    expect(errorMessage(done)).toBe(CRED_TEXT);
    expect(r.router.of('regenerate'), '憑證錯誤不重試').toHaveLength(1);
    expect(tree(r.v.dir)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toHaveLength(0);
    expect((await r.view('teach.poll')).card?.id).toBe(PARENT);
  });

  it('(2) 字數重寫呼叫丟 NoModelError:只略過那一張(skipped 1),其他卡照寫,不是整批 no-model', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => kids(['新卡2']);
        router.regenerate = () => new NoModelError('deepen');
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const created = cardFiles(r.v).filter((id) => !BASE.includes(id));
    expect(created).toHaveLength(1);
    expect(questionFiles(r.v).filter((id) => !BASE.includes(id))).toEqual(created);
    expect(r.router.of('questions'), '被略過的那張不出考題').toHaveLength(1);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ skipped: 1, children: created });
    expect(String(parseCardText(readFileSync(join(r.v.dir, 'cards/security', `${created[0]}.md`), 'utf8')).frontmatter['title'])).toBe('新卡1');
  });

  it('(3) 考題呼叫丟憑證錯誤:整個中止(credential-unavailable),不是略過那一張;磁碟沒變', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.questions = (_card, title) => (title === '新卡2' ? cred : JSON.stringify(VALID_QUESTIONS));
      },
    });
    await r.view('teach.open');
    const before = tree(r.v.dir);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('credential-unavailable');
    expect(errorMessage(done)).toBe(CRED_TEXT);
    expect(tree(r.v.dir), '第一張的考題與卡也不能留下').toEqual(before);
    expect(logEvents(r.v, 'deepened')).toHaveLength(0);
    expect(logEvents(r.v, 'warning')).toHaveLength(0);
  });

  it('(3 對照) 考題呼叫丟一般錯誤:只略過那一張,其他照寫(證明上一條的「整個中止」是憑證錯誤造成的)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.questions = (_card, title) => (title === '新卡2' ? '這不是 JSON' : JSON.stringify(VALID_QUESTIONS));
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(cardFiles(r.v).filter((id) => !BASE.includes(id))).toHaveLength(1);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ skipped: 1 });
  });
});

