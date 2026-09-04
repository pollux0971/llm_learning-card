/**
 * `cli.ts check-questions <learning-dir>` —— 三種 0 要分得出來。
 *
 * 現況(實測,三個都一樣):
 *
 *     $ npx tsx packages/core/src/schema/cli.ts check-questions <空的 learning 樹>
 *     OK   >>> exit=0
 *     $ npx tsx packages/core/src/schema/cli.ts check-questions <完全空的目錄>
 *     OK   >>> exit=0
 *     $ npx tsx packages/core/src/schema/cli.ts check-questions <根本不存在的路徑>
 *     OK   >>> exit=0
 *
 * 一個根本不存在的路徑印「OK」。`findCardsMissingQuestions()` 在 `cards/` 不存在時
 * 回 `[]`,而 CLI 只看「陣列是不是空的」,於是「沒有東西缺考題」跟「我沒有檢查任何
 * 東西」變成同一個答案。
 *
 * 要的形狀,跟 boundaries 那句「掃描 195 個檔案,允許例外 11 條」同一套:
 *
 *   1. **印出檢查了幾張卡**。`OK` 後面沒有數字就不知道那個 OK 有多少份量。
 *   2. **0 要分得出種類**:目錄不在 / 沒有 cards/ / cards 是空的,三句話兩兩不同。
 *   3. **退出碼分得開**:
 *        0  真的檢查過 N ≥ 1 張卡,全部都有 questions/
 *        1  檢查過 N ≥ 1 張卡,其中有缺的(既有行為,不動)
 *        2  **沒東西可檢查**——目錄不在、沒有 cards/、或 cards/ 底下 0 張卡
 *
 * 2 而不是 0,是因為對呼叫的人來說「我沒檢查」跟「我檢查完沒問題」是兩件事,
 * 而跟「檢查出問題」也是兩件事。cli.ts 本來就用 2 表示「這次沒有做成檢查」
 * (usage()),這裡是同一個意思的延伸。
 *
 * 剛 init 完的空 vault 會落在 2:那是誠實的答案——它確實沒有卡片可以檢查,
 * 而使用者要的是知道這件事,不是收到一個看起來像通過的 OK。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = 'packages/core/src/schema/cli.ts';
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-checkq-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function run(dir: string): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CLI, 'check-questions', dir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 一個有 cards/ 與 questions/ 的 learning 樹。`cards` 是 `{ 分類: [卡片 id] }`。 */
function vault(cards: Record<string, string[]>, questions: string[]): string {
  const dir = tmpDir();
  mkdirSync(join(dir, 'questions'), { recursive: true });
  for (const [category, ids] of Object.entries(cards)) {
    mkdirSync(join(dir, 'cards', category), { recursive: true });
    for (const id of ids) {
      writeFileSync(join(dir, 'cards', category, `${id}.md`), `# ${id}\n`, 'utf8');
    }
  }
  for (const id of questions) {
    writeFileSync(join(dir, 'questions', `${id}.yaml`), 'fill: []\n', 'utf8');
  }
  return dir;
}

describe('check-questions:檢查得成的兩種答案', () => {
  it('N 張卡全部有考題 → exit 0,而且印得出「檢查了 N 張卡」', () => {
    const dir = vault({ security: ['sec-0001', 'sec-0002'] }, ['sec-0001', 'sec-0002']);
    const { code, output } = run(dir);

    expect(code).toBe(0);
    expect(output).toMatch(/2\s*張卡/);
  }, SPAWN_TIMEOUT_MS);

  it('有卡片缺考題 → exit 1,張數與缺的數量都印得出來(既有行為 + 數字)', () => {
    const dir = vault({ security: ['sec-0001', 'sec-0002'] }, ['sec-0001']);
    const { code, output } = run(dir);

    expect(code).toBe(1);
    expect(output).toContain('sec-0002');
    // 「檢查了 2 張,其中 1 張缺」——分母跟分子都要在。
    expect(output).toMatch(/2\s*張卡/);
  }, SPAWN_TIMEOUT_MS);
});

describe('check-questions:三種 0', () => {
  it('目錄根本不存在 → exit 2,不是 OK', () => {
    const missing = join(tmpDir(), 'nope');
    const { code, output } = run(missing);

    expect(code).toBe(2);
    expect(output).not.toMatch(/^OK/m);
    expect(output).toContain(missing);
  }, SPAWN_TIMEOUT_MS);

  it('目錄在但沒有 cards/ → exit 2,而且說得出是少了 cards/', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'questions'), { recursive: true });
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toContain('cards');
    expect(output).not.toMatch(/^OK/m);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 在但一張卡都沒有 → exit 2,而且印「檢查了 0 張卡」', () => {
    const dir = vault({}, []);
    mkdirSync(join(dir, 'cards'), { recursive: true });
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toMatch(/0\s*張卡/);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 底下有分類目錄但裡面沒有 .md → 一樣是「0 張卡」的 exit 2', () => {
    // 這是最像「正常」的一種空:目錄樹完整、只是沒內容。
    const dir = vault({ security: [] }, []);
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toMatch(/0\s*張卡/);
  }, SPAWN_TIMEOUT_MS);

  it('三種 0 的輸出兩兩不同', () => {
    const noDir = run(join(tmpDir(), 'nope'));

    const noCards = tmpDir();
    mkdirSync(join(noCards, 'questions'), { recursive: true });

    const emptyCards = vault({ security: [] }, []);

    const outputs = [noDir.output, run(noCards).output, run(emptyCards).output];
    expect(new Set(outputs).size, `三種 0 有兩種長一樣:\n${outputs.join('\n---\n')}`).toBe(3);
  }, SPAWN_TIMEOUT_MS);

  it('沒給目錄參數仍是 exit 2 的用法錯誤(現在就綠,回歸鎖)', () => {
    const r = spawnSync('npx', ['tsx', CLI, 'check-questions'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(r.status).toBe(2);
    expect(`${r.stdout ?? ''}${r.stderr ?? ''}`).toContain('用法');
  }, SPAWN_TIMEOUT_MS);
});
