/**
 * T12:`prompt-check.ts --overlap <children run 目錄> <parents run 目錄> [--threshold <0..1>]`。
 * 計算在 parent-child-overlap.ts(測試見 parent-child-overlap.test.ts),這裡釘「使用者在終端機看到什麼、退出碼是什麼」:
 *
 *   - 0 對成立 → 退出碼 0;輸出有「重疊 0 對」、每個輸入的 key、以及「最高 0.150」(讓人看得出「0 對」是量過的,不是檢查壞了)
 *   - 有成立的對 → 退出碼 1;輸出點名 key、父卡 id、子卡 id 與重疊值(三位小數)
 *   - 目錄不存在 / 沒有 output 檔 / 配不起來 → 退出碼 1,訊息講原因,不丟 stack trace
 *   - 缺參數 → 退出碼 1,用法裡有 --overlap
 *   - `--threshold` 覆寫門檻;不是 0..1 的數字 → 退出碼 1
 *
 * 協調者每一輪 golden run 之後就跑這一條;退出碼 1 = 這一輪不及格(機器指標那一項)。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './cli.js';

const here = new URL('.', import.meta.url).pathname;
const CHILDREN = join(here, 'fixtures/golden-2026-10-15/ingest.children');
const PARENTS = join(here, 'fixtures/golden-2026-10-15/ingest.cards');

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});
function dirWith(files: Record<string, { title: string; body: string }[]>): string {
  const d = mkdtempSync(join(tmpdir(), 't12-cli-'));
  made.push(d);
  for (const [id, cards] of Object.entries(files)) {
    writeFileSync(join(d, `${id}.output.json`), JSON.stringify({ id, text: JSON.stringify(cards.map((c) => ({ ...c, examples: [] }))) }));
  }
  return d;
}

describe('--overlap:基準(2026-10-15)', () => {
  it('0 對成立 → 退出碼 0,印出每個輸入、「重疊 0 對」與最高值 0.150', async () => {
    const r = await main(['--overlap', CHILDREN, PARENTS]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toMatch(/重疊 0 對/);
    for (const key of ['cors', 'preflight', 'same-origin']) expect(r.output).toContain(key);
    expect(r.output).toMatch(/最高 0\.150/);
  });

  it('--threshold 拉到 0.15:基準最高的那一對(same-origin 的 c2 對 p3)成立 → 退出碼 1,點名兩邊 id 與 0.150', async () => {
    const r = await main(['--overlap', CHILDREN, PARENTS, '--threshold', '0.15']);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('same-origin');
    expect(r.output).toContain('p3');
    expect(r.output).toContain('c2');
    expect(r.output).toContain('0.150');
    expect(r.output).toMatch(/重疊 1 對/);
  });
});

describe('--overlap:合成輸入', () => {
  const PARENT_BODY = 'mixed-origin requests need explicit server consent before browsers expose responses to scripts';
  it('子卡逐字照抄父卡 → 退出碼 1,輸出有 key、p<序號>、c<序號>、1.000', async () => {
    const parents = dirWith({ 'cards-x': [{ title: '父', body: 'abcdefghijklmnop' }, { title: '父二', body: PARENT_BODY }] });
    const children = dirWith({ 'children-x': [{ title: '子', body: 'qrstuvwxyzqrstuv' }, { title: '子二', body: PARENT_BODY }] });
    const r = await main(['--overlap', children, parents]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('x');
    expect(r.output).toContain('p1');
    expect(r.output).toContain('c1');
    expect(r.output).toContain('1.000');
    expect(r.output).toMatch(/重疊 1 對/);
  });

  it('沒有重疊 → 退出碼 0', async () => {
    const parents = dirWith({ 'cards-x': [{ title: '父', body: 'abcdefghijklmnop' }] });
    const children = dirWith({ 'children-x': [{ title: '子', body: 'qrstuvwxyzqrstuv' }] });
    const r = await main(['--overlap', children, parents]);
    expect(r.code, r.output).toBe(0);
  });
});

describe('--overlap:錯誤要講原因,不丟例外', () => {
  it('目錄不存在 → 退出碼 1,訊息含那個路徑', async () => {
    const r = await main(['--overlap', '/no/such/children-dir', PARENTS]);
    expect(r.code).toBe(1);
    expect(r.output).toContain('/no/such/children-dir');
  });

  it('目錄裡沒有任何 output 檔(路徑打錯)→ 退出碼 1,不是「0 對」', async () => {
    const empty = mkdtempSync(join(tmpdir(), 't12-empty-'));
    made.push(empty);
    const r = await main(['--overlap', empty, PARENTS]);
    expect(r.code).toBe(1);
    expect(r.output).not.toMatch(/重疊 0 對/);
    expect(r.output).toContain(empty);
  });

  it('key 對不起來 → 退出碼 1,訊息點名那個 key', async () => {
    const parents = dirWith({ 'cards-x': [{ title: '父', body: 'abcdefghijklmnop' }] });
    const children = dirWith({ 'children-y': [{ title: '子', body: 'abcdefghijklmnop' }] });
    const r = await main(['--overlap', children, parents]);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/y/);
  });

  it('缺第二個目錄 → 退出碼 1,用法裡有 --overlap', async () => {
    const r = await main(['--overlap', CHILDREN]);
    expect(r.code).toBe(1);
    expect(r.output).toContain('--overlap');
  });

  it('--threshold 不是 0..1 的數字 → 退出碼 1', async () => {
    for (const bad of ['abc', '-0.1', '1.5', '']) {
      const r = await main(['--overlap', CHILDREN, PARENTS, '--threshold', bad]);
      expect(r.code, `--threshold ${JSON.stringify(bad)}\n${r.output}`).toBe(1);
      expect(r.output).toContain('--threshold');
    }
  });
});
