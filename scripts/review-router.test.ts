/**
 * T13(I2 整合):`scripts/review.ts` 與 `scripts/grade.ts` 不再用 Wave 0 的 FakeLlmRouter。
 *
 * 釘住的行為(全部是「使用者在終端機看到什麼、帳本被誰決定」,所以一律 spawn 真的 CLI):
 *
 *   review.ts 互動模式(不是 --dry-run)
 *     - 帳本位置只由指標檔決定(ADR-066):指標檔不存在、標記不符 → 退出碼 2,訊息指到 `scripts/vault.ts init`;
 *       **不退回任何預設、不換成 fake**。這一步在建 session 之前,所以今天有沒有卡到期都一樣(快速失敗)。
 *     - 指標與標記都對:照常進行(今天沒有到期 → "Nothing is due today.",退出碼 0)。
 *   review.ts --dry-run
 *     - 只讀、不評分、不花錢,**不需要**指標檔:沒有指標也照常列出清單(standalone.json 的 11-review-cli 就是這樣跑)。
 *   順序:0 張卡先擋(退出碼 1、「沒有卡片」),早於帳本檢查——沒有指標檔時也是,不能被 2 蓋掉。
 *   延後張數:到期的卡超過 daily_cap 時,輸出要有「N 張延後」一行(N = 超出的張數);沒有延後就不印這一行。
 *
 *   grade.ts --fill
 *     - 第一、二層(exact / fuzzy)從來不碰 router:沒有指標檔、沒有網路也照常(standalone.json 的 05-grading 就是這樣跑)。
 *     - 要用到第三層才需要 router,而 router 的帳本一樣只由指標檔決定:沒有指標 → 退出碼 2、指到 init;不退回 fake。
 *
 *   兩支入口的原始碼不再引用 FakeLlmRouter、預錄 fixtures 目錄。
 *
 * 子程序的 XDG_CONFIG_HOME 一律指到暫存目錄,所以永遠讀不到真的指標檔、也碰不到真的 learning/。
 * 沒有任何一個案例會打網路:要打網路的路在「指標檔不對」就被擋下,或根本不需要 router。
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SPAWN_TIMEOUT_MS = 60_000;
const TODAY = '2026-09-10';
const VAULT_INIT = 'scripts/vault.ts init';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

interface Rev {
  stage: number;
  learned_at: string;
  next_due: string | null;
  fails_in_row: number;
  total_fails: number;
  stuck: boolean;
  history: unknown[];
}
const rev = (nextDue: string, stage = 1): Rev => ({
  stage,
  learned_at: '2026-08-01',
  next_due: nextDue,
  fails_in_row: 0,
  total_fails: 0,
  stuck: false,
  history: [],
});

/** learning-minimal 的複本;reviews 照參數寫;cards:false → 一張卡也沒有。 */
function vault(opts: { reviews?: Record<string, Rev>; cards?: boolean; dailyCap?: number } = {}): string {
  const dir = tmp('lc-review-router-');
  cpSync(join(REPO_ROOT, 'contracts/fixtures/learning-minimal'), dir, { recursive: true });
  if (opts.cards === false) rmSync(join(dir, 'cards'), { recursive: true, force: true });
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(opts.reviews ?? {}, null, 2)}\n`);
  if (opts.dailyCap !== undefined) {
    const path = join(dir, 'config/settings.yaml');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^daily_cap:.*$/m, `daily_cap: ${opts.dailyCap}`));
  }
  return dir;
}

/** 指標檔 + 身分標記(對的)。回傳 XDG_CONFIG_HOME。 */
function xdgPointingAt(learningDir: string, opts: { markerOverride?: string } = {}): string {
  const xdg = tmp('lc-xdg-');
  const id = randomUUID();
  mkdirSync(join(xdg, 'llm-learning-cards'), { recursive: true });
  writeFileSync(join(xdg, 'llm-learning-cards/vault.json'), JSON.stringify({ learning_dir: learningDir, vault_id: id }));
  mkdirSync(join(learningDir, 'config'), { recursive: true });
  writeFileSync(join(learningDir, 'config/vault-id'), opts.markerOverride ?? `${id}\n`);
  return xdg;
}

/** 空的 XDG:沒有指標檔。 */
const emptyXdg = (): string => tmp('lc-xdg-empty-');

function run(script: string, args: string[], xdg: string, input = ''): { status: number | null; output: string; stdout: string } {
  const { NODE_OPTIONS: _drop, ...rest } = process.env;
  const r = spawnSync('npx', ['tsx', script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    input,
    env: { ...rest, XDG_CONFIG_HOME: xdg, LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'fake-model', OPENAI_API_KEY: 'fake-key' },
  });
  return { status: r.error ? null : r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
}

const review = (dir: string, xdg: string, extra: string[] = [], input = '') =>
  run('scripts/review.ts', ['--dir', dir, '--today', TODAY, ...extra], xdg, input);

describe('review.ts 互動模式:帳本只由指標檔決定,不退回 fake', () => {
  it('沒有指標檔 → 退出碼 2,訊息指到 vault.ts init,而且沒有動 reviews.json', () => {
    const dir = vault({ reviews: { 'sec-0001': rev(TODAY) } });
    const before = readFileSync(join(dir, 'state/reviews.json'), 'utf8');
    const r = review(dir, emptyXdg());
    expect(r.status, r.output).toBe(2);
    expect(r.output).toContain(VAULT_INIT);
    expect(r.output).not.toMatch(/FakeLlmRouter|沒有錄製/);
    expect(readFileSync(join(dir, 'state/reviews.json'), 'utf8')).toBe(before);
  }, SPAWN_TIMEOUT_MS * 2);

  it('身分標記與指標檔不符 → 退出碼 2,訊息講明標記不符', () => {
    const dir = vault({ reviews: { 'sec-0001': rev(TODAY) } });
    const xdg = xdgPointingAt(dir, { markerOverride: `${randomUUID()}\n` });
    const r = review(dir, xdg);
    expect(r.status, r.output).toBe(2);
    expect(r.output).toMatch(/標記/);
    expect(r.output).toContain(VAULT_INIT);
  }, SPAWN_TIMEOUT_MS * 2);

  it('今天沒有任何卡到期也一樣先查帳本(快速失敗,不是「沒事做就不查」)', () => {
    const dir = vault({ reviews: { 'sec-0001': rev('2026-12-01', 2) } });
    const r = review(dir, emptyXdg());
    expect(r.status, r.output).toBe(2);
    expect(r.output).not.toContain('Nothing is due today.');
  }, SPAWN_TIMEOUT_MS * 2);

  it('正面對照:指標與標記都對、今天沒有到期 → 照常說 Nothing is due today.,退出碼 0', () => {
    const dir = vault({ reviews: { 'sec-0001': rev('2026-12-01', 2) } });
    const r = review(dir, xdgPointingAt(dir));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain('Nothing is due today.');
  }, SPAWN_TIMEOUT_MS * 2);

  it('0 張卡先擋:沒有指標檔時退出碼也是 1(沒有卡片),不是 2', () => {
    const dir = vault({ cards: false });
    const r = review(dir, emptyXdg());
    expect(r.status, r.output).toBe(1);
    expect(r.output).toMatch(/沒有卡片/);
    expect(r.output).not.toContain(VAULT_INIT);
  }, SPAWN_TIMEOUT_MS * 2);
});

describe('review.ts --dry-run:只讀,不需要指標檔', () => {
  it('沒有指標檔也照常列出到期清單,退出碼 0', () => {
    const dir = vault({ reviews: { 'sec-0001': rev(TODAY) } });
    const r = review(dir, emptyXdg(), ['--dry-run']);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/sec-0001\s+stage 1/);
    expect(r.output).not.toContain(VAULT_INIT);
  }, SPAWN_TIMEOUT_MS * 2);
});

describe('review.ts:超過 daily_cap 的卡要報告「N 張延後」', () => {
  const many = (n: number): Record<string, Rev> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`sec-${String(i + 1).padStart(4, '0')}`, rev(TODAY)]));

  it('15 張到期、上限 10 → 列出 10 張,並說 5 張延後', () => {
    const dir = vault({ reviews: many(15), dailyCap: 10 });
    const r = review(dir, emptyXdg(), ['--dry-run']);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(/(^|\D)5\s*張延後/m);
    expect(r.output.split('\n').filter((l) => /^sec-\d+\s+stage/.test(l))).toHaveLength(10);
  }, SPAWN_TIMEOUT_MS * 2);

  it('正面對照的反面:3 張到期、上限 10 → 沒有延後,不印「延後」', () => {
    const dir = vault({ reviews: many(3), dailyCap: 10 });
    const r = review(dir, emptyXdg(), ['--dry-run']);
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toMatch(/延後/);
    expect(r.output.split('\n').filter((l) => /^sec-\d+\s+stage/.test(l))).toHaveLength(3);
  }, SPAWN_TIMEOUT_MS * 2);

  it('剛好等於上限(10 張、上限 10)也不印延後', () => {
    const dir = vault({ reviews: many(10), dailyCap: 10 });
    const r = review(dir, emptyXdg(), ['--dry-run']);
    expect(r.output).not.toMatch(/延後/);
  }, SPAWN_TIMEOUT_MS * 2);
});

describe('grade.ts --fill:第三層才需要 router,帳本一樣只由指標檔決定', () => {
  const Q = 'contracts/fixtures/learning-minimal/questions/sec-0001.yaml';
  const grade = (answer: string, xdg: string) => run('scripts/grade.ts', ['--fill', '--q', Q, '--index', '1', '--answer', answer], xdg);

  it('第一層(exact)沒有指標檔也照常:退出碼 0,grader 是 exact', () => {
    const r = grade('否', emptyXdg());
    expect(r.status, r.output).toBe(0);
    const result = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { pass: boolean; grader: string };
    expect(result).toMatchObject({ pass: true, grader: 'exact' });
  }, SPAWN_TIMEOUT_MS * 2);

  it('要用到第三層、而且沒有指標檔 → 退出碼 2,訊息指到 vault.ts init;不退回 fake', () => {
    const r = grade('完全不相干的一長串字 zzzzzzzzzzzz', emptyXdg());
    expect(r.status, r.output).toBe(2);
    expect(r.output).toContain(VAULT_INIT);
    expect(r.output).not.toMatch(/FakeLlmRouter|沒有錄製/);
  }, SPAWN_TIMEOUT_MS * 2);
});

describe('入口原始碼不再引用 Wave 0 的 fake', () => {
  for (const file of ['scripts/review.ts', 'scripts/grade.ts']) {
    it(`${file} 沒有 FakeLlmRouter、預錄 fixtures 目錄`, () => {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(text).not.toMatch(/FakeLlmRouter|fixtures\/llm|loadFixturesFromDir/);
    });
  }

  it('grading 的 FakeLlmRouter 檔案與匯出都已移除(05 FEATURE.md 的「Wave 0 的重複」整合時移除)', () => {
    expect(() => readFileSync(join(REPO_ROOT, 'packages/core/src/grading/fake-llm.ts'), 'utf8')).toThrow();
    const index = readFileSync(join(REPO_ROOT, 'packages/core/src/grading/index.ts'), 'utf8');
    expect(index).not.toMatch(/fake-llm/);
  });
});
