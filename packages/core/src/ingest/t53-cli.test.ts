/**
 * T53 單元測試 E:`scripts/ingest.ts` 的 CLI——`--file` 跑法的修正(刻意的例外),和新的掃描跑法的退出碼。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T53-ingest-phase3-incremental-stale.md「A」「B」與顧問 D1、加 2。
 *
 *   --file:
 *     - 分類不存在 → 照舊建(require_raw: true),並印一行「新建分類 <id>(require_raw: true)」;
 *     - 分類已經存在 → 不動它(不覆寫 name、require_raw),不印「新建分類」;
 *     - raw/<分類>/<檔名> 已存在且內容相同 → 不複製(不寫檔,mtime 不變);
 *     - 已存在但內容不同 → 拒絕,退出碼 1,印出是哪個檔,原檔位元組不變,不呼叫 LLM、不寫卡。
 *   掃描 / 主題(不給 --file;--topic <文字>、--category <id>):
 *     - 分類沒有設定 → 退出碼 1,印「沒有定義」,輸出目錄前後完全相同;
 *     - 要求 raw 的分類沒有 raw 卻給了主題 → 退出碼 1,印「要求 raw」;
 *     - 有 raw 又給主題 → 退出碼 0,印「被略過」;
 *     - 來源改了 → 退出碼 0(有 stale 不是失敗)。
 * 子行程用 `node --import tsx scripts/ingest.ts --fake`(離線、確定性)。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ensureInitialized, setCategory } from './init.js';
import { REPO_ROOT, mtimeOf, rawText, treeHash, writeRaw } from './t53-test-support.js';

const SCRIPT = join(REPO_ROOT, 'scripts/ingest.ts');
const SAMPLE = join(REPO_ROOT, 'contracts/fixtures/raw/security-basics.md'); // fixtures 錄了它的回應(--fake 讀得到)

function run(args: string[]): { status: number | null; out: string } {
  const { NODE_OPTIONS: _ignored, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--fake', ...args], { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 120_000 });
  return { status: r.error ? null : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const freshDir = (): string => mkdtempSync(join(tmpdir(), 'lc-t53-cli-'));
const categoriesOf = (dir: string): { id: string; name: string; require_raw: boolean }[] =>
  (yamlParse(readFileSync(join(dir, 'config/categories.yaml'), 'utf8')) as { id: string; name: string; require_raw: boolean }[] | null) ?? [];

describe('T53 E. --file:分類', () => {
  it('分類不存在 → 照舊建 require_raw: true,並印「新建分類」那一行(讓人看得到打錯字)', () => {
    const dir = freshDir();
    const r = run(['--file', SAMPLE, '--out', dir, '--category', 'security']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/新建分類.*security/);
    expect(categoriesOf(dir)).toEqual([{ id: 'security', name: 'security', require_raw: true }]);
  });

  it('分類已經存在 → 不覆寫 name 與 require_raw,也不印「新建分類」', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: false });
    const r = run(['--file', SAMPLE, '--out', dir, '--category', 'security']);
    expect(r.status, r.out).toBe(0);
    expect(categoriesOf(dir), '已經設定好的分類原樣').toEqual([{ id: 'security', name: '資安', require_raw: false }]);
    expect(r.out).not.toMatch(/新建分類/);
  });
});

describe('T53 E. --file:raw/ 一個位元組都不亂改(硬規則 2)', () => {
  it('同名但內容不同 → 退出碼 1、印出是哪個檔、原檔不變、不寫卡', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    const rel = writeRaw(dir, 'security', 'security-basics.md', '使用者自己的素材,跟要複製進來的不一樣。\n');
    const before = readFileSync(join(dir, rel), 'utf8');
    const r = run(['--file', SAMPLE, '--out', dir, '--category', 'security']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('security-basics.md');
    expect(readFileSync(join(dir, rel), 'utf8'), '原檔位元組不變').toBe(before);
    const cards = existsSync(join(dir, 'cards/security')) ? readdirSync(join(dir, 'cards/security')) : [];
    expect(cards, '不寫卡').toEqual([]);
  });

  it('同名同內容 → 不複製(mtime 不變),照常往下跑', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    const target = join(dir, 'raw/security/security-basics.md');
    copyFileSync(SAMPLE, target);
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(target, old, old);
    const m = mtimeOf(target);
    const r = run(['--file', SAMPLE, '--out', dir, '--category', 'security']);
    expect(r.status, r.out).toBe(0);
    expect(mtimeOf(target), '內容相同不重寫').toBe(m);
  });
});

describe('T53 E. 掃描 / 主題跑法的退出碼與訊息', () => {
  it('分類沒有設定 → 退出碼 1、印「沒有定義」、輸出目錄前後完全相同', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    const before = treeHash(dir);
    const r = run(['--out', dir, '--category', 'ghost']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/沒有定義/);
    expect(treeHash(dir)).toBe(before);
    const t = run(['--out', dir, '--category', 'ghost', '--topic', '怎麼煮咖啡']);
    expect(t.status, t.out).toBe(1);
    expect(t.out).toMatch(/沒有定義/);
    expect(treeHash(dir), '主題跑法也一樣').toBe(before);
  });

  it('要求 raw 的分類沒有 raw 卻給了主題 → 退出碼 1、印「要求 raw」、不寫卡', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    const r = run(['--out', dir, '--category', 'security', '--topic', '同源政策']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/要求 raw/);
    expect(existsSync(join(dir, 'cards/security')) ? readdirSync(join(dir, 'cards/security')) : []).toEqual([]);
  });

  it('不要求 raw、沒有 raw、給了主題 → 退出碼 1、印「還沒做」', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'peach', name: '桃子', require_raw: false });
    const r = run(['--out', dir, '--category', 'peach', '--topic', '桃子的種法']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/還沒做/);
  });

  it('有 raw 又給主題 → 退出碼 0、印「被略過」、卡的 source 是 raw', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: false });
    mkdirSync(join(dir, 'raw/security'), { recursive: true });
    copyFileSync(SAMPLE, join(dir, 'raw/security/security-basics.md'));
    const r = run(['--out', dir, '--category', 'security', '--topic', '同源政策']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/被略過/);
    const cards = readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.md'));
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const f of cards) expect(readFileSync(join(dir, 'cards/security', f), 'utf8')).toMatch(/^source: raw$/m);
  });

  it('來源改了 → 退出碼 0(有 stale 不是失敗)、卡被標 stale', () => {
    const dir = freshDir();
    ensureInitialized(dir);
    setCategory(dir, { id: 'security', name: '資安', require_raw: true });
    const first = run(['--file', SAMPLE, '--out', dir, '--category', 'security']);
    expect(first.status, first.out).toBe(0);
    writeFileSync(join(dir, 'raw/security/security-basics.md'), rawText('edited'), 'utf8');
    const r = run(['--out', dir, '--category', 'security']);
    expect(r.status, r.out).toBe(0);
    const cards = readdirSync(join(dir, 'cards/security')).filter((f) => f.endsWith('.md'));
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const f of cards) expect(readFileSync(join(dir, 'cards/security', f), 'utf8'), f).toMatch(/^stale: true$/m);
  });
});
