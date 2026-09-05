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
import { dirname, join, resolve } from 'node:path';

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

/**
 * 把暫存路徑換成固定字樣,剩下的才是「訊息本身」。
 *
 * 三個案例用三個不同的暫存目錄,不去掉路徑的話,只要訊息印了路徑就永遠兩兩不同——
 * 把三句話全部清空仍然綠。「三種 0 兩兩不同」比的是訊息,不是輸出。
 */
function withoutPath(output: string, ...paths: string[]): string {
  let s = output;
  for (const p of paths) s = s.split(p).join('<PATH>').split(dirname(p)).join('<DIR>');
  return s;
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
    expect(output).toContain('沒有檢查任何東西');
  }, SPAWN_TIMEOUT_MS);

  it('路徑存在但是一個檔案 → exit 2,說「不是目錄」,不是掉進 readdirSync 的 ENOTDIR stack', () => {
    const file = join(tmpDir(), 'learning.md');
    writeFileSync(file, '這是一個檔案,不是 learning 目錄\n', 'utf8');
    const { code, output } = run(file);

    expect(code).toBe(2);
    expect(output).not.toMatch(/^OK/m);
    expect(output).toContain('不是目錄');
    expect(output).toContain(file);
    expect(output).not.toMatch(/^\s+at .+:\d+:\d+\)?$/m);
    // 一種 0 只講一件事:守門之後就收工,不會接著又說「底下沒有 cards/」。
    expect(output).not.toContain('沒有 cards/');
  }, SPAWN_TIMEOUT_MS);

  it('目錄在但沒有 cards/ → exit 2,而且說得出是少了 cards/', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'questions'), { recursive: true });
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toContain('cards');
    expect(output).not.toMatch(/^OK/m);
    // 使用者要做的事:還沒 init 就 init,不然去確認路徑。
    expect(output).toContain('init');
    // 一種 0 只講一件事:說完「沒有 cards/」就收工,不會接著又說「檢查了 0 張卡」。
    expect(output).not.toMatch(/0\s*張卡/);
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 在但一張卡都沒有 → exit 2,而且印「檢查了 0 張卡」', () => {
    const dir = vault({}, []);
    mkdirSync(join(dir, 'cards'), { recursive: true });
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toMatch(/0\s*張卡/);
    // 這是最像「正常」的空,所以要明講:空的 vault 不算「全部都有考題」。
    expect(output).toContain('空的 vault');
  }, SPAWN_TIMEOUT_MS);

  it('cards/ 底下有分類目錄但裡面沒有 .md → 一樣是「0 張卡」的 exit 2', () => {
    // 這是最像「正常」的一種空:目錄樹完整、只是沒內容。
    const dir = vault({ security: [] }, []);
    const { code, output } = run(dir);

    expect(code).toBe(2);
    expect(output).toMatch(/0\s*張卡/);
  }, SPAWN_TIMEOUT_MS);

  it('三種 0 的訊息兩兩不同(路徑正規化之後比,不是比輸出)', () => {
    const noDir = join(tmpDir(), 'nope');

    const noCards = tmpDir();
    mkdirSync(join(noCards, 'questions'), { recursive: true });

    const emptyCards = vault({ security: [] }, []);

    const messages = [
      withoutPath(run(noDir).output, noDir),
      withoutPath(run(noCards).output, noCards),
      withoutPath(run(emptyCards).output, emptyCards),
    ];

    // 每一種 0 都要真的有話說;三句去掉路徑之後仍然兩兩不同。
    for (const m of messages) expect(m.trim(), '有一種 0 一句話都沒說').not.toBe('');
    expect(new Set(messages).size, `三種 0 有兩種長一樣:\n${messages.join('\n---\n')}`).toBe(3);
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
