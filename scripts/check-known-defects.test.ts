// SOURCE: template v1.4.2 (1c1d403) sha256=b6eb91e46a1d347ab412b2f34d2cb9b442cab2196c2792452a160905e7ecc6d8 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-known-defects.ts 的單元測試(模板 1.4.0 S8)。
 *
 * cucumber 的列舉這一步用 `KNOWN_DEFECTS_ENUMERATE_CMD` 注入(見這支腳本檔頭說明):
 * 指到一個印出「跟 cucumber --format json 頂層格式一致」內容的 shell 指令,不需要
 * 臨時 repo 真的裝 cucumber、真的有 features/steps 就能測完整的比對邏輯。
 *
 * 額外一組測試(標「real cucumber」)直接對 `/data/python/llm_learning-cards`
 * (這個 worktree外的唯讀原始 repo)跑真的 cucumber 列舉,驗證這支腳本跟真的
 * cucumber --format json 輸出真的對得上——如果那個環境沒有裝 cucumber 就印原因跳過,
 * 不讓 CI 因為外部環境而紅。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_KNOWN_DEFECTS_TS = resolve(import.meta.dirname, 'check-known-defects.ts');
const SPAWN_TIMEOUT_MS = 60_000;

const tmpDirs: string[] = [];
let originalEnumerateCmd: string | undefined;

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-known-defects-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  return dir;
}

function writeRegistry(root: string, entries: unknown): void {
  writeFileSync(join(root, 'scripts', 'known-defects.json'), JSON.stringify(entries, null, 2), 'utf8');
}

function write(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function writeFeaturePhase(root: string, folder: string, phaseNum: number, status: string): void {
  const dir = join(root, 'features', folder);
  mkdirSync(dir, { recursive: true });
  const content = [
    `# ${folder}`,
    '',
    '## Phase',
    '',
    '| Phase | 標題 | 階段 | 狀態 | 完成日 |',
    '|---|---|---|---|---|',
    `| ${phaseNum} | 標題 | Wave 0 | ${status} |  |`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'FEATURE.md'), content, 'utf8');
}

function writeDecisionMap(root: string, adrIds: string[]): void {
  const body = adrIds.map((id) => `## ADR-${id} · 測試用決策\n\n- **Decision**: 測試\n`).join('\n');
  write(root, 'docs/02-decision-map.md', `# 決策地圖\n\n${body}`);
}

/** cucumber `--format json` 頂層格式的假輸出:一個 feature,一個場景,`tags` 就是那個
 *  場景實際掛的 tag(不含 `--tags` 篩選這件事——這支腳本本來就不信任外層篩選,
 *  所以測試也故意讓「假 cucumber」回傳一些沒有 @known-defect 的場景,驗證這支腳本
 *  自己會把它們濾掉)。 */
function fakeCucumberJson(features: { uri: string; scenarios: { name: string; tags: string[] }[] }[]): string {
  return JSON.stringify(
    features.map((f) => ({
      uri: f.uri,
      elements: f.scenarios.map((s) => ({
        type: 'scenario',
        name: s.name,
        tags: s.tags.map((t) => ({ name: t })),
      })),
    })),
  );
}

/** 寫一個會印出固定 JSON 的假「cucumber 列舉」腳本,回傳可以塞進
 *  `KNOWN_DEFECTS_ENUMERATE_CMD` 的指令字串。 */
function writeEnumerateStub(root: string, json: string): string {
  const p = join(root, 'enumerate.mjs');
  writeFileSync(p, `process.stdout.write(${JSON.stringify(json)});\n`, 'utf8');
  return `node ${p}`;
}

function run(root: string, enumerateCmd: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_KNOWN_DEFECTS_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts'), KNOWN_DEFECTS_ENUMERATE_CMD: enumerateCmd },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

beforeEach(() => {
  originalEnumerateCmd = process.env.KNOWN_DEFECTS_ENUMERATE_CMD;
});

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  if (originalEnumerateCmd === undefined) delete process.env.KNOWN_DEFECTS_ENUMERATE_CMD;
  else process.env.KNOWN_DEFECTS_ENUMERATE_CMD = originalEnumerateCmd;
});

describe('check-known-defects:tag 與登記表對上', () => {
  it('完全對上 → PASS', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '01-foo', 1, 'todo');
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'A known bug', reason: 'flaky', fix_in: '01-foo/phase-1', since: '2026-01-01', hard_rule: false },
    ]);
    const cmd = writeEnumerateStub(
      root,
      fakeCucumberJson([{ uri: 'features/01-foo/phase-1.feature', scenarios: [{ name: 'A known bug', tags: ['@known-defect'] }] }]),
    );

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('gate=known-defects result=PASS scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('掛了 tag 但沒登記 → FAIL,訊息明講「帶 @known-defect 但沒登記」', () => {
    const root = makeRoot();
    writeRegistry(root, []);
    const cmd = writeEnumerateStub(
      root,
      fakeCucumberJson([{ uri: 'features/01-foo/phase-1.feature', scenarios: [{ name: 'Unregistered bug', tags: ['@known-defect'] }] }]),
    );

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('✗ 帶 @known-defect 但沒登記:features/01-foo/phase-1.feature :: Unregistered bug');
    expect(output).toContain('gate=known-defects result=FAIL scanned=1');
  }, SPAWN_TIMEOUT_MS);

  it('登記了但場景沒掛 tag(或不存在)→ FAIL,訊息明講「登記了但場景不存在或沒帶 tag」', () => {
    const root = makeRoot();
    writeFeaturePhase(root, '01-foo', 1, 'todo');
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'Ghost bug', reason: 'x', fix_in: '01-foo/phase-1', since: '2026-01-01', hard_rule: false },
    ]);
    // 假 cucumber 回傳這個場景,但沒有掛 @known-defect(驗證「不信任外層 --tags 篩選」那條)。
    const cmd = writeEnumerateStub(
      root,
      fakeCucumberJson([{ uri: 'features/01-foo/phase-1.feature', scenarios: [{ name: 'Ghost bug', tags: [] }] }]),
    );

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('✗ 登記了但場景不存在或沒帶 tag:features/01-foo/phase-1.feature :: Ghost bug');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-known-defects:0 目標的例外(不是掃描器壞了)', () => {
  it('登記表是空的、也沒有任何場景掛 tag → exit 1,但訊息說「這支 gate 現在用不到」,不是「掃描器壞了」', () => {
    const root = makeRoot();
    writeRegistry(root, []);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('這支 gate 現在用不到');
    expect(output).not.toContain('這不是很乾淨,是掃描器壞了');
    expect(output).toContain('gate=known-defects result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('登記表用 `_doc` metadata 項目(不算條目)加上沒有任何 tag → 一樣落在 0 目標例外', () => {
    const root = makeRoot();
    writeRegistry(root, [{ _doc: '這是說明,不是登記' }]);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('登記表 ');
    expect(output).toContain(' 有 0 筆');
    expect(output).toContain('這支 gate 現在用不到');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-known-defects:fix_in 規則 (d)(e)', () => {
  it('hard_rule=true 且 fix_in 是佔位值(未定/TBD/空字串)→ 大聲失敗,不能合法化', () => {
    const root = makeRoot();
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: '未定', since: '2026-01-01', hard_rule: true },
    ]);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('hard_rule=true');
    expect(output).toContain('不能靠一個「之後再修」的標記合法化');
    expect(output).toContain('gate=known-defects result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('hard_rule=false 且 fix_in 是佔位值 → 允許(不擋,只要 tag 對得上)', () => {
    const root = makeRoot();
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: 'TBD', since: '2026-01-01', hard_rule: false },
    ]);
    const cmd = writeEnumerateStub(
      root,
      fakeCucumberJson([{ uri: 'features/01-foo/phase-1.feature', scenarios: [{ name: 'x', tags: ['@known-defect'] }] }]),
    );

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('gate=known-defects result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('fix_in 是 "<NN-x>/phase-M" 但那個 phase 表格列不存在 → 大聲失敗', () => {
    const root = makeRoot();
    // 故意不寫 FEATURE.md,phase 表格列自然不存在。
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: '01-foo/phase-9', since: '2026-01-01', hard_rule: false },
    ]);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('"fix_in" 參照不存在');
    expect(output).toContain('phase-9');
  }, SPAWN_TIMEOUT_MS);

  it('fix_in 是 "ADR-NNN" 但那個 ADR 不存在 → 大聲失敗', () => {
    const root = makeRoot();
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: 'ADR-999', since: '2026-01-01', hard_rule: false },
    ]);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('"fix_in" 參照不存在');
    expect(output).toContain('ADR-999');
  }, SPAWN_TIMEOUT_MS);

  it('fix_in 是 "ADR-NNN" 且那個 ADR 存在 → 通過', () => {
    const root = makeRoot();
    writeDecisionMap(root, ['12']);
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: 'ADR-12', since: '2026-01-01', hard_rule: true },
    ]);
    const cmd = writeEnumerateStub(
      root,
      fakeCucumberJson([{ uri: 'features/01-foo/phase-1.feature', scenarios: [{ name: 'x', tags: ['@known-defect'] }] }]),
    );

    const { code, output } = run(root, cmd);

    expect(code).toBe(0);
    expect(output).toContain('gate=known-defects result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('fix_in 格式看不懂(既不是 phase 參照也不是 ADR 也不是佔位值)→ 大聲失敗', () => {
    const root = makeRoot();
    writeRegistry(root, [
      { feature: 'features/01-foo/phase-1.feature', scenario: 'x', reason: 'x', fix_in: 'someday', since: '2026-01-01', hard_rule: false },
    ]);
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('"fix_in" 格式看不懂');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-known-defects:S9 設定檔壞掉', () => {
  it('known-defects.json 是壞掉的 JSON → 印「設定檔壞掉」,不是未捕捉的堆疊', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'scripts', 'known-defects.json'), '[ broken', 'utf8');
    const cmd = writeEnumerateStub(root, fakeCucumberJson([]));

    const { code, output } = run(root, cmd);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=known-defects result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
  }, SPAWN_TIMEOUT_MS);

  it('cucumber 列舉指令的輸出不是合法 JSON → 大聲失敗', () => {
    const root = makeRoot();
    writeRegistry(root, []);
    const stubPath = join(root, 'bad-enumerate.mjs');
    writeFileSync(stubPath, "process.stdout.write('not json');\n", 'utf8');

    const { code, output } = run(root, `node ${stubPath}`);

    expect(code).toBe(1);
    expect(output).toContain('不是合法 JSON');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// 對真的 cucumber 跑一次真的列舉(唯讀,對 /data/python/llm_learning-cards 這個
// worktree 外的原始 repo,不改動它)。那個環境如果沒裝 cucumber 就印原因跳過。
// ---------------------------------------------------------------------------

describe('check-known-defects:real cucumber 列舉(唯讀,對照真實環境)', () => {
  const REAL_CONSUMER_ROOT = '/data/python/llm_learning-cards';

  it('對真的 consumer repo 跑 --dry-run --tags @known-defect --format json,腳本能正確解析(0 目標例外)', () => {
    const cucumberBin = join(REAL_CONSUMER_ROOT, 'node_modules', '.bin', 'cucumber-js');
    if (!existsSync(cucumberBin)) {
      console.log(`跳過:${REAL_CONSUMER_ROOT} 沒有裝 cucumber(${cucumberBin} 不存在)`);
      return;
    }
    if (!existsSync(join(REAL_CONSUMER_ROOT, 'cucumber.js'))) {
      console.log(`跳過:${REAL_CONSUMER_ROOT} 沒有 cucumber.js 設定`);
      return;
    }

    // 這個唯讀 repo 目前沒有 scripts/known-defects.json(這是模板要新增的檔案,
    // consumer 還沒採用)——複製這支腳本跟 _root.ts 到一個臨時目錄,`--root` 指向
    // 真的 consumer,`--cwd` 指向真的 consumer(cucumber.js 在那裡),但登記表用
    // 一個空的臨時檔案(GATES_CONFIG_DIR 指過去),不寫入 consumer 自己的樹。
    const scratchDir = mkdtempSync(join(tmpdir(), 'lc-known-defects-real-'));
    tmpDirs.push(scratchDir);
    mkdirSync(join(scratchDir, 'scripts'), { recursive: true });
    writeFileSync(join(scratchDir, 'scripts', 'known-defects.json'), '[]', 'utf8');

    const r = spawnSync(
      'npx',
      ['tsx', CHECK_KNOWN_DEFECTS_TS, '--root', REAL_CONSUMER_ROOT, '--cwd', REAL_CONSUMER_ROOT],
      {
        cwd: REAL_CONSUMER_ROOT,
        encoding: 'utf8',
        timeout: SPAWN_TIMEOUT_MS,
        env: { ...process.env, GATES_CONFIG_DIR: join(scratchDir, 'scripts') },
      },
    );
    const code = r.status ?? -1;
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    // 這個唯讀 repo(目前)沒有任何場景掛 @known-defect,登記表(臨時的空陣列)也是空的,
    // 所以應該落在「0 目標的例外」——但重點是驗證:真的 cucumber 列舉跑起來、
    // JSON 真的被這支腳本解析成功(沒有「不是合法 JSON」或未捕捉的堆疊)。
    expect(output).toContain('cucumber 列舉到 0 個 @known-defect 場景');
    expect(output).not.toContain('不是合法 JSON');
    expect(output).not.toContain('SyntaxError');
    expect(code).toBe(1);
    expect(output).toContain('這支 gate 現在用不到');
  }, SPAWN_TIMEOUT_MS);
});
