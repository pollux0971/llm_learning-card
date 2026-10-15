/**
 * T6:ingest 遇到不合法的分類(raw 資料夾名或明講的 category)要拒絕,而且什麼都不建。
 * 作者:測試 agent。開發 worker 不改。
 *
 * 「什麼都不建」用輸出目錄的完整列檔(路徑 + 內容雜湊)前後相等來判,不是只看幾個檔不存在。
 * 兩種起點:空目錄(runIngest 連骨架都不能先建)與已有骨架的目錄。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest, runIngestPipeline } from './ingest.js';
import { ensureInitialized, setCategory } from './init.js';
import type { LlmResult, LlmRouter } from './types.js';

function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(root, r));
      if (st.isDirectory()) {
        out.push(`${r}/`);
        walk(r);
      } else {
        out.push(`${r} ${createHash('sha256').update(readFileSync(join(root, r))).digest('hex')}`);
      }
    }
  };
  walk('');
  return out;
}

function countingRouter(): { router: LlmRouter; calls: () => number } {
  let n = 0;
  const text = JSON.stringify([
    { title: '卡一', body: '第一張卡的正文內容。', examples: [], lines: [1, 2] },
    { title: '卡二', body: '第二張卡的正文內容。', examples: [], lines: [3, 4] },
    { title: '卡三', body: '第三張卡的正文內容。', examples: [], lines: [5, 6] },
  ]);
  const router: LlmRouter = {
    async call(): Promise<LlmResult> {
      n += 1;
      return { text, provider: 'fake', model: 'mock', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
  return { router, calls: () => n };
}

// [資料夾名, rule]。非 ASCII 一律用跳脫寫真碼位。
const BAD: Array<[string, string]> = [
  ['C++', 'charset'],
  ['\u1100\u1161', 'nfc'],
  ['a.', 'trailing-dot'],
  ['.hidden', 'leading-dot'],
  ['nul', 'reserved'],
  ['\uac00'.repeat(21) + 'ab', 'length'],
];

describe.each(['runIngest', 'runIngestPipeline'] as const)('%s 拒絕不合法的分類', (fn) => {
  const run = fn === 'runIngest' ? runIngest : runIngestPipeline;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-t6-ingest-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function putRaw(folder: string): string {
    mkdirSync(join(dir, 'raw', folder), { recursive: true });
    writeFileSync(join(dir, 'raw', folder, 'x.md'), '一些原始內容\n'.repeat(10), 'utf8');
    return `raw/${folder}/x.md`;
  }

  describe.each([
    ['空目錄起點(只有 raw)', false],
    ['骨架已存在的起點', true],
  ] as const)('%s', (_label, withSkeleton) => {
    it.each(BAD)('資料夾 %s:拒絕、退出碼非 0、訊息含資料夾名與 rule %s、LLM 沒被呼叫、輸出目錄零變動', async (folder, rule) => {
      const rawRelPath = putRaw(folder);
      if (withSkeleton) ensureInitialized(dir);
      const before = snapshot(dir);
      const { router, calls } = countingRouter();

      const result = await run({ outDir: dir, rawRelPath, router });

      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.message).toContain(folder);
      expect(result.message).toContain(rule);
      expect(calls()).toBe(0);
      expect(snapshot(dir)).toEqual(before);
    });
  });

  it('明講的 category 不合法也拒絕(raw 資料夾本身是合法的),輸出目錄零變動', async () => {
    const rawRelPath = putRaw('security');
    const before = snapshot(dir);
    const { router, calls } = countingRouter();

    const result = await run({ outDir: dir, rawRelPath, category: 'C++', router });

    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain('C++');
    expect(result.message).toContain('charset');
    expect(calls()).toBe(0);
    expect(snapshot(dir)).toEqual(before);
  });

  it('正向對照:Security 與 セキュリティー(結尾 U+30FC)照常 ingest,沒有誤殺', async () => {
    for (const folder of ['Security', '\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc']) {
      const rawRelPath = putRaw(folder);
      const { router, calls } = countingRouter();
      const result = await run({ outDir: dir, rawRelPath, router });
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.cardsCreated.length).toBe(3);
      expect(calls()).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------- 驗收補測(測試 agent,T6 驗收時加的)

describe('驗收補測:setCategory 不寫不合法的分類 id', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 't6-accept-set-'));
    ensureInitialized(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('S15: 不合法的 id 丟錯(訊息帶被拒絕的值與 rule 名),categories.yaml 一個位元組都沒變', () => {
    const before = snapshot(root);
    expect(() => setCategory(root, { id: 'C++', name: 'x', require_raw: true })).toThrow(/C\+\+.*charset/);
    expect(() => setCategory(root, { id: 'a.', name: 'x', require_raw: true })).toThrow(/trailing-dot/);
    expect(() => setCategory(root, { id: '', name: 'x', require_raw: true })).toThrow(/empty/);
    expect(snapshot(root)).toEqual(before);
  });

  it('對照:合法的 id 照常寫進 categories.yaml', () => {
    setCategory(root, { id: 'Security', name: 'Security', require_raw: true });
    expect(readFileSync(join(root, 'config/categories.yaml'), 'utf8')).toContain('Security');
  });
});

describe('驗收補測:真正的使用者入口 scripts/ingest.ts 遇到不合法分類,也要「拒絕、什麼都不建、有人看得懂的訊息」', () => {
  const REPO = join(import.meta.dirname, '../../../..');
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 't6-accept-cli-'));
    writeFileSync(join(work, 'note.md'), '# 筆記\n\n第一行。\n第二行。\n', 'utf8');
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ['--import=tsx', join(REPO, 'scripts/ingest.ts'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', HOME: work, XDG_CONFIG_HOME: join(work, 'xdg'), XDG_RUNTIME_DIR: join(work, 'run') },
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it.each([['C++', 'charset'], ['a.', 'trailing-dot'], ['nul', 'reserved']])(
    '--category %s(rule %s):退出碼非 0,訊息帶值與 rule 名,不是一段 stack trace;全新的輸出目錄前後相等(連骨架都沒建)',
    (category, rule) => {
      const out = join(work, 'out');
      mkdirSync(out);
      const before = snapshot(out);
      const r = cli(['--fake', '--file', join(work, 'note.md'), '--out', out, '--category', category]);
      expect(r.status).not.toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain(category);
      expect(`${r.stdout}${r.stderr}`).toContain(rule);
      expect(r.stderr, '使用者看到的是 stack trace').not.toMatch(/\n\s+at /);
      expect(snapshot(out), '輸出目錄被動過').toEqual(before);
    },
    90_000,
  );

  it('已有骨架的輸出目錄:不合法分類被拒絕後,整棵樹(路徑加內容雜湊)前後相等', () => {
    const out = join(work, 'out');
    mkdirSync(out);
    ensureInitialized(out);
    const before = snapshot(out);
    const r = cli(['--fake', '--file', join(work, 'note.md'), '--out', out, '--category', 'C++']);
    expect(r.status).not.toBe(0);
    expect(snapshot(out)).toEqual(before);
  }, 90_000);

  it('對照:合法的分類照常跑完(不是整個 CLI 都壞了才綠)', () => {
    const out = join(work, 'out');
    mkdirSync(out);
    const r = cli(['--fake', '--file', join(REPO, 'contracts/fixtures/raw/security-basics.md'), '--out', out, '--category', 'Security']);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(readdirSync(join(out, 'cards', 'Security')).length).toBeGreaterThan(0);
  }, 90_000);
});
