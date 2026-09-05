// SOURCE: template v1.4.3 (629b609) sha256=b9926cf9d38ae773956deb52018136d050f91dbff1bfc7956aeefdb321446a48 — 勿手改;升版用 sync-gates.sh
/**
 * scripts/check-doc-rot.ts 的單元測試(模板 1.4.0 S7)。
 *
 * 跟其餘掃描器的測試同一個形狀:造一次性的臨時目錄當假 consumer 根,`--root` +
 * `GATES_CONFIG_DIR`(指到 `<fixture>/scripts`)明講,不碰真的 repo。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHECK_DOC_ROT_TS = resolve(import.meta.dirname, 'check-doc-rot.ts');
const ROOT_TS = resolve(import.meta.dirname, '_root.ts');
const SPAWN_TIMEOUT_MS = 60_000;
const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-doc-rot-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  return dir;
}

function writeBlacklist(root: string, entries: unknown): void {
  writeFileSync(join(root, 'scripts', 'doc-rot.blacklist.json'), JSON.stringify(entries, null, 2), 'utf8');
}

function writeGatesConfig(root: string, config: unknown): void {
  writeFileSync(join(root, 'scripts', 'gates.config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function write(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

function run(root: string, ...extra: string[]): { code: number; output: string } {
  const r = spawnSync('npx', ['tsx', CHECK_DOC_ROT_TS, '--root', root, ...extra], {
    cwd: root,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, GATES_CONFIG_DIR: join(root, 'scripts') },
  });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const ONE_RULE = [
  { pattern: 'llm-learning-cards-\\d+', reason: '寫死的顧問 session 名字', since: '2026-09-05', incident: 'P-59' },
];

/**
 * P-83(來源 專案 A,2026-09-05,採用模板 1.4.1 之後):消費者自己的「不准繞過鎖」
 * 掃描器把這份測試檔裡寫死的一段連續字面值(繞過檔案鎖直接跑變異測試的 Stryker CLI
 * 指令)當成真的違規命中——對那支掃描器來說,fixture 裡的字面值跟真的貼在文件裡的
 * 字面值長得一模一樣。改成陣列 `.join(' ')` 串接組出來,這份檔案自己就不再含一段
 * 可以照抄貼上的連續字面值(見 `template/scripts/no-bypass-literal.test.ts`、
 * PITFALLS.md P-83)。
 */
const STRYKER_BYPASS_LITERAL = ['npx', 'stryker', 'run'].join(' ');

describe('check-doc-rot:命中黑名單', () => {
  it('一個檔案命中一條規則、預設 docRot.mode(report)→ marker 印 FAIL 但 exit 0,訊息含 file:line 與規則資訊', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/notes.md', '見顧問 session llm-learning-cards-57 討論。\n');

    const { code, output } = run(root);

    // S13 (b):全新安裝的預設值是 "report"——命中一樣全部印出來、marker 一樣印
    // result=FAIL(讓讀 log 的人看得出來),但 exit 0,不擋其他工作。
    expect(code).toBe(0);
    expect(output).toContain('docs/notes.md:1');
    expect(output).toContain('命中黑名單「llm-learning-cards-\\d+」');
    expect(output).toContain('P-59');
    expect(output).toContain('gate=doc-rot result=FAIL');
    expect(output).toContain('docRot.mode = "report"');
  }, SPAWN_TIMEOUT_MS);

  it('docRot.mode 明講 "enforce" → 命中一樣的內容,但這次 exit 1', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    writeGatesConfig(root, { docRot: { mode: 'enforce' } });
    write(root, 'docs/notes.md', '見顧問 session llm-learning-cards-57 討論。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('docs/notes.md:1');
    expect(output).toContain('gate=doc-rot result=FAIL');
    expect(output).not.toContain('docRot.mode = "report"');
  }, SPAWN_TIMEOUT_MS);

  it('同樣的字串出現在 docs/02-decision-map.md(ADR 檔)→ 不報', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/02-decision-map.md', '## ADR-001 · 決定不要再用 llm-learning-cards-57\n\n理由略。\n');
    write(root, 'docs/other.md', '無關內容,純粹讓掃描器有東西可掃。\n'); // 避免「0 個檔案」蓋掉這條測試想驗的東西

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('02-decision-map.md');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('同樣的字串出現在 docs/adr/ 底下 → 不報', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/adr/0001-foo.md', '決定不要再用 llm-learning-cards-57。\n');
    write(root, 'docs/other.md', '無關內容,純粹讓掃描器有東西可掃。\n');

    const { code } = run(root);

    expect(code).toBe(0);
  }, SPAWN_TIMEOUT_MS);

  it('沒有命中 → PASS', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/notes.md', '一切正常,沒有可疑字串。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('黑名單設定檔自己不會自我命中', () => {
    const root = makeRoot();
    // pattern 字串本身就含 "llm-learning-cards" 這個子字串,故意測「不排除自己就會自我命中」。
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/notes.md', '沒有可疑字串。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    // 不能整段斷言「不包含 doc-rot.blacklist.json:」——那段字串現在也會出現在每支 gate
    // 開跑前印的「設定:...」透明度那一行(S14)裡,不是命中訊息;真正要驗的是「沒有把
    // 黑名單檔自己列成命中」,也就是不該出現帶行號的命中格式 `doc-rot.blacklist.json:<N>`。
    expect(output).not.toMatch(/doc-rot\.blacklist\.json:\d+/);
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('.claude/worktrees/ 底下的檔案不被掃到(多層路徑前綴,不是單層目錄名)', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/notes.md', '沒有可疑字串,純粹讓掃描器有東西可掃。\n');
    // .claude 跟 worktrees 是兩層,單純逐層比對目錄名永遠比不到 ".claude/worktrees"
    // 這個帶斜線的字串——這裡放一個會命中的檔案在裡面,驗證真的被當成整段路徑前綴排除
    // (不是只補一個叫 "worktrees" 的單層目錄名而已)。
    write(root, '.claude/worktrees/other-agent/docs/inner.md', '見顧問 session llm-learning-cards-99。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('.claude/worktrees');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-doc-rot:0 目標一律 FAIL', () => {
  it('黑名單是空陣列 → exit 1,scanned=0', () => {
    const root = makeRoot();
    writeBlacklist(root, []);
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('掃到 0 個檔案(副檔名都不符)→ exit 1,scanned=0', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'notes.unknownext', 'llm-learning-cards-57\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('找不到 doc-rot.blacklist.json,不帶 --root(一般已裝好之後正常執行的情境)→ exit 1,可執行的訊息', () => {
    const root = makeRoot();
    write(root, 'docs/notes.md', '內容。\n');
    // 「完全不存在」要真的模擬 sync 之後的安裝目錄:把 check-doc-rot.ts 跟它依賴的
    // _root.ts 複製進 fixture 的 scripts/,對這份複製本身執行——不設 GATES_CONFIG_DIR、
    // 也不帶 --root(S14 之後,--root 明講時這個情境會改印新的硬錯誤訊息,見下面
    // 「S14」那個 describe 區塊)。cwd 設在 fixture 目錄底下、fixture 不是 git repo,
    // _root.ts 的 `resolveRoot()` 會退回 `process.cwd()` 本身,順位 1、2 都指到同一個
    // 沒有 doc-rot.blacklist.json 的目錄。不這樣做的話,「腳本自己所在的目錄」
    // (找設定檔的順位 1)會是模板真正的 scripts/,那裡有一份真的 doc-rot.blacklist.json,
    // 會蓋掉這個測試想模擬的情境(跟 check-boundaries.test.ts 的「owners.json 完全不存在」
    // 測試是同一個坑)。
    copyFileSync(CHECK_DOC_ROT_TS, join(root, 'scripts', 'check-doc-rot.ts'));
    copyFileSync(ROOT_TS, join(root, 'scripts', '_root.ts'));

    const r = spawnSync('npx', ['tsx', join(root, 'scripts', 'check-doc-rot.ts')], {
      cwd: root,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    const code = r.status ?? -1;
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    expect(code).toBe(1);
    expect(output).toContain('找不到 doc-rot.blacklist.json');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S14(模板 1.4.1,來源 AI_KM 2026-09-05,PITFALLS P-73):--root 明講時的設定檔搜尋順序,
// 不准退回腳本自身所在目錄。
// ---------------------------------------------------------------------------

describe('check-doc-rot:S14 --root 明講時的設定檔解析(P-73)', () => {
  it('--root 明講、沒設 GATES_CONFIG_DIR、<root>/scripts 沒有 doc-rot.blacklist.json → 印新的硬錯誤訊息,不退回腳本自身目錄', () => {
    const root = makeRoot();
    write(root, 'docs/notes.md', '內容。\n');
    copyFileSync(CHECK_DOC_ROT_TS, join(root, 'scripts', 'check-doc-rot.ts'));
    copyFileSync(ROOT_TS, join(root, 'scripts', '_root.ts'));

    const r = spawnSync('npx', ['tsx', join(root, 'scripts', 'check-doc-rot.ts'), '--root', root], {
      cwd: root,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    const code = r.status ?? -1;
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    expect(code).toBe(1);
    expect(output).toContain(
      `✗ 設定檔未找到於 ${join(root, 'scripts', 'doc-rot.blacklist.json')}(--root 明講時不退回腳本自身目錄;要指定別處請設 GATES_CONFIG_DIR)`,
    );
    expect(output).not.toContain('找不到 doc-rot.blacklist.json(搜尋過');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('模板路徑跟 consumer 路徑不同時,--root 明講會用 consumer 自己的黑名單,不是腳本自身(模板)目錄那份', () => {
    const templateDir = makeRoot();
    copyFileSync(CHECK_DOC_ROT_TS, join(templateDir, 'scripts', 'check-doc-rot.ts'));
    copyFileSync(ROOT_TS, join(templateDir, 'scripts', '_root.ts'));
    // 模板自己的佔位黑名單:只有一條 consumer 用不到的規則。
    writeBlacklist(templateDir, [
      { pattern: 'only-in-template-pattern', reason: 'r', since: '2026-01-01', incident: 'X' },
    ]);

    const consumerDir = makeRoot();
    writeBlacklist(consumerDir, ONE_RULE);
    write(consumerDir, 'docs/notes.md', '見顧問 session llm-learning-cards-57。\n');

    const r = spawnSync(
      'npx',
      ['tsx', join(templateDir, 'scripts', 'check-doc-rot.ts'), '--root', consumerDir],
      { cwd: templateDir, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
    );
    const code = r.status ?? -1;
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    // 用的是 consumer 的黑名單(含 llm-learning-cards-\d+)→ 命中(report 模式預設 exit 0)。
    expect(code).toBe(0);
    expect(output).toContain(`設定:${join(consumerDir, 'scripts', 'doc-rot.blacklist.json')}`);
    expect(output).not.toContain(join(templateDir, 'scripts', 'doc-rot.blacklist.json'));
    expect(output).toContain('命中黑名單「llm-learning-cards-\\d+」');
  }, SPAWN_TIMEOUT_MS);
});

describe('check-doc-rot:S9 設定檔壞掉', () => {
  it('doc-rot.blacklist.json 是壞掉的 JSON → 印「設定檔壞掉」,不是未捕捉的堆疊', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'scripts', 'doc-rot.blacklist.json'), '[ broken', 'utf8');
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('✗ 設定檔壞掉:');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
    expect(output).not.toContain('at JSON.parse');
  }, SPAWN_TIMEOUT_MS);

  it('一筆缺欄位(缺 "reason")→ 每個欄位都是必填,大聲失敗', () => {
    const root = makeRoot();
    writeBlacklist(root, [{ pattern: 'x', since: '2026-01-01', incident: 'P-1' }]);
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('一筆的 "reason" 是空字串 → 大聲失敗(不可為空)', () => {
    const root = makeRoot();
    writeBlacklist(root, [{ pattern: 'x', reason: '  ', since: '2026-01-01', incident: 'P-1' }]);
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('不可為空字串');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('一筆的 "pattern" 不是合法正規表達式 → 大聲失敗', () => {
    const root = makeRoot();
    writeBlacklist(root, [{ pattern: '(unclosed', reason: 'r', since: '2026-01-01', incident: 'P-1' }]);
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('不是合法正規表達式');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('一筆有不認識的欄位(打錯字)→ 大聲失敗(S13 (d))', () => {
    const root = makeRoot();
    writeBlacklist(root, [
      { pattern: 'x', reason: 'r', since: '2026-01-01', incident: 'P-1', raeson: '打錯字' },
    ]);
    write(root, 'docs/notes.md', '內容。\n');

    const { code, output } = run(root);

    expect(code).toBe(1);
    expect(output).toContain('不認識的欄位:raeson');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);

  it('一筆帶選填的 "note" 欄位 → 合法,照常運作(S13 (d))', () => {
    const root = makeRoot();
    writeBlacklist(root, [
      { pattern: 'x', reason: 'r', since: '2026-01-01', incident: 'P-1', note: '收斂時的判斷依據' },
    ]);
    write(root, 'docs/notes.md', '沒有可疑字串。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('陣列裡帶 "_doc" 鍵的項目是 metadata,不算條目(跟 known-defects.json 同一個慣例)', () => {
    const root = makeRoot();
    writeBlacklist(root, [
      { _doc: '這份黑名單的說明,不是規則' },
      { pattern: 'llm-learning-cards-\\d+', reason: 'r', since: '2026-01-01', incident: 'P-59' },
    ]);
    write(root, 'docs/notes.md', '沒有可疑字串。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).toContain('1 條黑名單規則');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S13 (a):事故日誌(PITFALLS.md、CHANGELOG.md)與決策記錄的預設排除。
// ---------------------------------------------------------------------------

describe('check-doc-rot:S13 (a) 事故日誌 / 決策記錄預設排除', () => {
  it('PITFALLS.md 逐字引用黑名單命中的字串 → 不報(預設排除,不管在哪個目錄底下)', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'PITFALLS.md', '事故記錄:見顧問 session llm-learning-cards-57。\n');
    write(root, 'docs/other.md', '無關內容,純粹讓掃描器有東西可掃。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('PITFALLS.md:');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('template/CHANGELOG.md(嵌套路徑)逐字引用黑名單命中的字串 → 不報', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'template/CHANGELOG.md', '1.4.0:修正 llm-learning-cards-57 這個坑。\n');
    write(root, 'docs/other.md', '無關內容,純粹讓掃描器有東西可掃。\n');

    const { code, output } = run(root);

    expect(code).toBe(0);
    expect(output).not.toContain('CHANGELOG.md:');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('不是 PITFALLS.md / CHANGELOG.md 的一般檔案,同樣的字串仍然照報(排除只針對這兩個檔名)', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    write(root, 'docs/notes.md', '見顧問 session llm-learning-cards-57。\n');

    const { code, output } = run(root);

    expect(code).toBe(0); // report 模式預設 exit 0
    expect(output).toContain('docs/notes.md:1');
    expect(output).toContain('gate=doc-rot result=FAIL');
  }, SPAWN_TIMEOUT_MS);

  it('docRot.exclude 在 gates.config.json 追加一條 glob,不取代預設排除清單', () => {
    const root = makeRoot();
    writeBlacklist(root, ONE_RULE);
    writeGatesConfig(root, { docRot: { exclude: ['vendor/**'] } });
    write(root, 'vendor/readme.md', '見顧問 session llm-learning-cards-57。\n'); // 自訂排除
    write(root, 'PITFALLS.md', '事故記錄:llm-learning-cards-57。\n'); // 預設排除仍然生效
    write(root, 'docs/notes.md', '見顧問 session llm-learning-cards-99。\n'); // 一般檔案仍然照報

    const { code, output } = run(root);

    expect(code).toBe(0); // report 模式預設
    expect(output).not.toContain('vendor/readme.md');
    expect(output).not.toContain('PITFALLS.md:');
    expect(output).toContain('docs/notes.md:1');
  }, SPAWN_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// S13 (c):--self-test。
// ---------------------------------------------------------------------------

describe('check-doc-rot:S13 (c) --self-test', () => {
  it('對出貨的黑名單(3 條規則)跑 --self-test → 全部命中自己的探針,exit 0', () => {
    const root = makeRoot();
    writeBlacklist(root, [
      { pattern: 'llm-learning-cards-\\d+', reason: 'r1', since: '2026-09-05', incident: 'P-59' },
      { pattern: STRYKER_BYPASS_LITERAL, reason: 'r2', since: '2026-09-05', incident: 'mutate-lock-bypass' },
      { pattern: '核心四項', reason: 'r3', since: '2026-09-05', incident: 'nightmare-assault' },
    ]);

    const { code, output } = run(root, '--self-test');

    expect(code).toBe(0);
    expect(output).toContain('✓ self-test:3 條規則,探針全部命中自己');
    expect(output).toContain('gate=doc-rot result=PASS');
  }, SPAWN_TIMEOUT_MS);

  it('串接組出來的 STRYKER_BYPASS_LITERAL,拼出來仍然是真正的違規指令(不是改壞了語意)', () => {
    // 不能直接寫死那句 Stryker CLI 指令的完整字面值來比對——那樣這份檔案又會多一次
    // 可以照抄貼上的連續字面值,繞了一圈又踩回 P-83。改用字元碼獨立重建同一個字串:
    // 兩種構造方式
    // (陣列串接 vs. 字元碼)各自壞掉的機率互相獨立,才夠格叫「pin」,不是同義反覆。
    const rebuiltFromCharCodes = String.fromCharCode(
      110, 112, 120, 32, 115, 116, 114, 121, 107, 101, 114, 32, 114, 117, 110,
    );
    expect(STRYKER_BYPASS_LITERAL).toBe(rebuiltFromCharCodes);
    expect(STRYKER_BYPASS_LITERAL).toHaveLength(15);
  });

  it('一條規則的探針合成不出來(對自己沒命中)→ 印指名哪一條,exit 1(不是靜默當成過)', () => {
    const root = makeRoot();
    writeBlacklist(root, [
      // 這個 pattern 用了 lookahead,現有的探針合成器（只處理 \d \w \s 與逃脫字元）
      // 生不出一個會讓它自己命中的字串——這正是這個測試要驗的:誠實回報「沒命中」,
      // 不是假裝每條規則都測得出來。
      { pattern: 'foo(?=bar)', reason: 'r', since: '2026-01-01', incident: 'P-1' },
    ]);

    const { code, output } = run(root, '--self-test');

    expect(code).toBe(1);
    expect(output).toContain('✗ self-test:黑名單第 1 條「foo(?=bar)」對自己的探針沒命中');
  }, SPAWN_TIMEOUT_MS);

  it('黑名單是空陣列(排除 _doc 後 0 條)→ --self-test 也是 FAIL,不是「沒事可測」', () => {
    const root = makeRoot();
    writeBlacklist(root, [{ _doc: '只有說明,沒有真的規則' }]);

    const { code, output } = run(root, '--self-test');

    expect(code).toBe(1);
    expect(output).toContain('沒有規則可以自我測試');
    expect(output).toContain('gate=doc-rot result=FAIL scanned=0');
  }, SPAWN_TIMEOUT_MS);
});
