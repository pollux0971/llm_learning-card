import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, runList, SCANNER_BROKEN } from './cli.js';
import { DEFAULT_GOLDEN_BASE_DIR, DEFAULT_FAKE_GOLDEN_BASE_DIR } from './golden-run.js';
import { listGoldenSets, PROMPTS_DIR, REAL_TASK_GOLDEN_SET_IDS, scanPromptFiles } from './golden-sets/registry.js';
import type { PromptCoverage } from './golden-sets/registry.js';

/** runList 的守門分支要直接餵 coverage 才驗得到——repo 現在是全綠的狀態。 */
function listWith(coverage: Partial<PromptCoverage>): { code: number; output: string } {
  const lines: string[] = [];
  return runList((s) => lines.push(s), lines, {
    scanned: [],
    unregistered: [],
    missing: [],
    duplicated: [],
    scannerBroken: false,
    ...coverage,
  });
}

// 每個會寫檔的測試都用 --out 指到自己的暫存目錄,afterEach 只清這些暫存目錄。
// 絕對不對 repo 裡的 golden/ 或 golden-fake/ 讀寫或刪除:那些是真的基準資料,
// 「跑 npm test 就把 git 追蹤的 golden 檔刪掉」正是 ADR-032 要防的靜默毀掉品質(審核意見)。
const tmpDirs: string[] = [];
function tmpOutDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pq-cli-'));
  tmpDirs.push(d);
  return d;
}

function snapshotRepoGoldenDirs(): string {
  const list = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);
  return JSON.stringify({ golden: list(DEFAULT_GOLDEN_BASE_DIR), fake: list(DEFAULT_FAKE_GOLDEN_BASE_DIR) });
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/**
 * `--live` 走的是 03 的真 router,造假只在網路邊界(globalThis.fetch),
 * 理由同 live-run.test.ts:換成注入假 router 就等於什麼都沒驗到。
 * 這裡驗的是 **CLI 這一層**——花費那行、結構性問題那行、離線時的退出碼。
 */
const LIVE_MODEL = 'claude-sonnet-5';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFakeCloud(opts: { online?: boolean; replyText?: string } = {}): void {
  const { online = true, replyText = JSON.stringify({ criteria: [true, false], feedback: '還可以' }) } = opts;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/v1/models')) return jsonResponse({ data: [] }, online ? 200 : 500);
    if (url.includes('/v1/messages')) {
      return jsonResponse({
        id: 'msg_fake', type: 'message', role: 'assistant', model: LIVE_MODEL,
        content: [{ type: 'text', text: replyText }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
      });
    }
    throw new Error(`cli.test 沒有預期到的請求:${url}`);
  }) as typeof globalThis.fetch;
}

describe('cli main --live', () => {
  let realFetch: typeof globalThis.fetch;
  let realEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realEnv = { ...process.env };
    process.env.LLM_CLOUD_PROVIDER = 'anthropic';
    process.env.LLM_CLOUD_MODEL = LIVE_MODEL;
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = realEnv;
  });

  it('印出模型、token 進出,以及「不在價目表上就不估」的花費', async () => {
    installFakeCloud();
    const out = tmpOutDir();
    const result = await main(['--golden', '--set', 'selftest', '--live', '--out', out]);
    expect(result.code).toBe(0);
    const line = result.output.split('\n').find((l) => l.includes('模型'))!;
    expect(line).toBe('  模型 anthropic/claude-sonnet-5,token 進 300 出 120,花費 (model 不在價目表上,不估)');
    expect(result.output.split('\n').filter((l) => l.startsWith('  ⚠ '))).toEqual([]);
  });

  it('有結構性問題時逐項列出,結尾那句說清楚那不代表品質不好', async () => {
    installFakeCloud({ replyText: JSON.stringify({ criteria: [true] }) });
    const out = tmpOutDir();
    const result = await main(['--golden', '--set', 'selftest', '--live', '--out', out]);
    expect(result.code).toBe(0);
    const lines = result.output.split('\n');
    expect(lines.filter((l) => l.startsWith('  ⚠ '))).toEqual([
      '  ⚠ demo-1: rubric-too-few',
      '  ⚠ demo-2: rubric-too-few',
      '  ⚠ demo-3: rubric-too-few',
    ]);
    expect(lines[lines.length - 1]).toBe(
      'golden run 完成:處理了 3 個 golden 輸入,3 個結構性問題(不代表品質不好,是不是好內容要人評分)',
    );
  });

  it('離線時退出碼 1,而且叫人改用 --fake', async () => {
    installFakeCloud({ online: false });
    const out = tmpOutDir();
    const result = await main(['--golden', '--set', 'selftest', '--live', '--out', out]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('live golden run 需要雲端');
    expect(result.output).toContain('--fake');
    expect(existsSync(join(out, 'selftest'))).toBe(false);
  });
});

describe('cli main', () => {
  it('--golden --fake 沒指定 set 時,跑登記表裡的每一組,退出碼 0', async () => {
    const out = tmpOutDir();
    const result = await main(['--golden', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('golden');
    expect(result.output).toMatch(/處理了 \d+ 個 golden 輸入/);
    for (const id of listGoldenSets()) expect(existsSync(join(out, id))).toBe(true);
  });

  it('--golden --fake 五組真任務加自我測試,一共 18 個輸入都跑得起來', async () => {
    const out = tmpOutDir();
    const result = await main(['--golden', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.output).toContain('處理了 18 個 golden 輸入');
    for (const id of REAL_TASK_GOLDEN_SET_IDS) {
      expect(result.output).toContain(`✓ golden run ${id} →`);
    }
  });

  /**
   * 花費那行只屬於 `--live`。條件寫死成 true 的話,fake run 也會印一行
   * 「token 進 0 出 0」——重播 fixture 沒有 token 資訊,那行等於在說謊。
   */
  it('fake run 不印模型與花費那一行,結尾也不提結構性問題', async () => {
    const out = tmpOutDir();
    const result = await main(['--golden', '--set', 'selftest', '--fake', '--out', out]);
    expect(result.output).not.toContain('模型');
    expect(result.output).not.toContain('花費');
    const lines = result.output.split('\n');
    expect(lines[lines.length - 1]).toBe('golden run 完成:處理了 3 個 golden 輸入');
  });

  it('--golden --out 指到哪裡就寫到哪裡,不碰 repo 裡的 golden 目錄', async () => {
    const before = snapshotRepoGoldenDirs();
    const out = tmpOutDir();
    const result = await main(['--golden', '--set', 'selftest', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.output).toContain(out);
    expect(snapshotRepoGoldenDirs()).toBe(before);
  });

  it('--out 沒接目錄時報錯', async () => {
    const result = await main(['--golden', '--fake', '--out']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--out');
  });

  it('--golden --set 指定沒登記的一組,清楚報錯並指出定義檔位置', async () => {
    const result = await main(['--golden', '--set', 'not-registered', '--fake', '--out', tmpOutDir()]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('not-registered');
    expect(result.output).toMatch(/registry\.ts/);
  });

  /**
   * 旗標排在 argv 第一個時也要讀得到。`indexOf` 的結果拿去比 `>= 0` 還是 `> 0`,
   * 只有這個位置分得出來——寫成 `> 0` 的話第一個旗標會被當成沒給,
   * 於是「只跑一組」靜靜地變成「跑全部」。
   */
  it('--set 排在 argv 第一個時仍然只跑那一組', async () => {
    const out = tmpOutDir();
    const result = await main(['--set', 'selftest', '--golden', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(readdirSync(out)).toEqual(['selftest']);
  });

  // 舊旗標 --task 仍然收(phase-1 的文件與 standalone.json 用的是它),語意就是 --set。
  it('--task 是 --set 的舊名字,行為一樣', async () => {
    const out = tmpOutDir();
    const result = await main(['--golden', '--task', 'selftest', '--fake', '--out', out]);
    expect(result.code).toBe(0);
    expect(existsSync(join(out, 'selftest'))).toBe(true);
  });

  // phase-2 起 --live 是真的模式(見 live-run.test.ts)。這裡只驗 CLI 這一層的旗標處理,
  // 不打網路——真正的 live 行為由 runGolden 負責。
  it('--fake 與 --live 同時給時拒絕', async () => {
    const result = await main(['--golden', '--fake', '--live', '--out', tmpOutDir()]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--live');
  });

  it('用法字串把 --live 列出來', async () => {
    const result = await main([]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--live');
  });

  // ------------------------------------------------------------------ --list
  //
  // `--list` 不只是印清單:它是「框架有沒有接上真的東西」的守門。
  // 沒被任何 golden set 引用的 prompt 檔就退出碼 1(工單第 3 項)。

  /**
   * 逐行比對而不是 `toContain`:輸出是**用換行接起來的**,`join('')` 這種
   * 「全部黏成一行」的壞法在 `toContain` 底下完全看不出來,但人讀起來是一坨。
   */
  it('--list 逐行印出六組,每行是「id → LlmTask、prompt 檔、輸入數」', async () => {
    const result = await main(['--list']);
    expect(result.code).toBe(0);
    const lines = result.output.split('\n');
    expect(lines[0]).toBe('登記的 golden set:');
    expect(lines.slice(1, 7)).toEqual([
      `- ingest.cards → LlmTask ingest.cards,prompt ${PROMPTS_DIR}/ingest/cards.md,3 個輸入`,
      `- ingest.children → LlmTask ingest.cards,prompt ${PROMPTS_DIR}/ingest/children.md,3 個輸入`,
      `- ingest.regenerate → LlmTask ingest.cards,prompt ${PROMPTS_DIR}/ingest/regenerate.md,3 個輸入`,
      `- ingest.questions → LlmTask ingest.questions,prompt ${PROMPTS_DIR}/ingest/questions.md,3 個輸入`,
      `- ingest.deps → LlmTask ingest.deps,prompt ${PROMPTS_DIR}/ingest/deps.md,3 個輸入`,
      '- selftest → LlmTask grade.apply,prompt packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md,3 個輸入(自我測試,不是真實任務)',
    ]);
  });

  it('只有 selftest 那行帶「自我測試」註記,五組真任務的行沒有', async () => {
    const lines = (await main(['--list'])).output.split('\n');
    for (const id of REAL_TASK_GOLDEN_SET_IDS) {
      const line = lines.find((l) => l.startsWith(`- ${id} →`))!;
      expect(line).not.toContain('自我測試');
    }
    expect(lines.find((l) => l.startsWith('- selftest →'))).toContain('(自我測試,不是真實任務)');
  });

  it('--list 在每個 prompt 檔都被登記時是綠的,清單與結論之間空一行', async () => {
    const result = await main(['--list']);
    expect(result.code).toBe(0);
    const lines = result.output.split('\n');
    expect(lines[7]).toBe('');
    expect(lines[8]).toBe(`${PROMPTS_DIR}/ 底下掃到 ${scanPromptFiles().length} 個 prompt 檔。`);
    expect(lines[9]).toBe('✓ 每個 prompt 檔都恰好被一組 golden set 登記。');
    expect(lines.length).toBe(10);
  });

  it('有 prompt 檔沒被登記時退出碼 1,而且指名是哪一個', () => {
    const result = listWith({ scanned: ['packages/core/prompts/ingest/_probe.md'], unregistered: ['packages/core/prompts/ingest/_probe.md'] });
    expect(result.code).toBe(1);
    const lines = result.output.split('\n');
    expect(lines[lines.length - 1]).toBe(
      '✗ 這個 prompt 檔沒有任何 golden set 登記,改了它不會有人發現:packages/core/prompts/ingest/_probe.md',
    );
    expect(result.output).not.toContain('✓ 每個 prompt 檔都恰好被一組 golden set 登記');
  });

  it('登記表指到不存在的 prompt 檔時退出碼 1', () => {
    const result = listWith({ scanned: ['a.md'], missing: ['packages/core/prompts/ingest/沒了.md'] });
    expect(result.code).toBe(1);
    const lines = result.output.split('\n');
    expect(lines[lines.length - 1]).toBe('✗ 登記表指到不存在的 prompt 檔:packages/core/prompts/ingest/沒了.md');
  });

  it('掃到 0 個 prompt 檔時退出碼 1,而且說的是「掃描器壞了」不是「很乾淨」(P-28)', () => {
    const result = listWith({ scannerBroken: true });
    expect(result.code).toBe(1);
    const lines = result.output.split('\n');
    expect(lines[lines.length - 2]).toBe(`${PROMPTS_DIR}/ 底下掃到 0 個 prompt 檔。`);
    expect(lines[lines.length - 1]).toBe(`✗ 一個 prompt 檔都沒掃到:${SCANNER_BROKEN}(${PROMPTS_DIR}/)`);
    expect(result.output).not.toContain('✓ 每個 prompt 檔都恰好被一組 golden set 登記');
  });

  it('掃描器壞掉時就停在那裡,不再逐條抱怨沒登記的檔', () => {
    const result = listWith({ scannerBroken: true, unregistered: ['x.md'], missing: ['y.md'] });
    expect(result.code).toBe(1);
    expect(result.output).not.toContain('x.md');
    expect(result.output).not.toContain('y.md');
  });

  it('掃描器壞掉時也不抱怨重複引用——0 個檔的時候那件事沒有意義', () => {
    const result = listWith({
      scannerBroken: true,
      duplicated: [{ promptFile: 'dup.md', sets: ['ingest.cards', 'selftest'] }],
    });
    expect(result.code).toBe(1);
    expect(result.output).not.toContain('dup.md');
  });

  /**
   * 反向驗證的第二個方向:引用數 2。
   * `unregistered` / `missing` 都是空的(每個檔都還有人引用),只有這一項會紅。
   */
  it('一個 prompt 檔被兩組登記時退出碼 1,指名檔案與那兩組', () => {
    const result = listWith({
      scanned: [`${PROMPTS_DIR}/ingest/cards.md`],
      duplicated: [{ promptFile: `${PROMPTS_DIR}/ingest/cards.md`, sets: ['ingest.cards', 'selftest'] }],
    });
    expect(result.code).toBe(1);
    const lines = result.output.split('\n');
    expect(lines[lines.length - 1]).toBe(
      `✗ 這個 prompt 檔被 2 組 golden set 登記(要恰好一組),ingest.cards / selftest 都指到:${PROMPTS_DIR}/ingest/cards.md`,
    );
    expect(result.output).not.toContain('✓ 每個 prompt 檔都恰好被一組 golden set 登記');
  });

  it('多個檔各自被重複登記時逐條列出', () => {
    const result = listWith({
      scanned: ['a.md', 'b.md'],
      duplicated: [
        { promptFile: 'a.md', sets: ['ingest.cards', 'ingest.children'] },
        { promptFile: 'b.md', sets: ['ingest.deps', 'ingest.questions', 'selftest'] },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('被 2 組 golden set 登記(要恰好一組),ingest.cards / ingest.children 都指到:a.md');
    expect(result.output).toContain(
      '被 3 組 golden set 登記(要恰好一組),ingest.deps / ingest.questions / selftest 都指到:b.md',
    );
  });

  it('--diff 碰到舊版面的 run 目錄時退出碼 1,訊息說得出新目錄長什麼樣', async () => {
    const base = tmpOutDir();
    const dirA = join(base, 'grade.apply', '2026-09-02');
    const dirB = join(base, 'grade.apply', '2026-09-03');
    for (const d of [dirA, dirB]) {
      mkdirSync(d, { recursive: true });
      // 舊 meta:有 task、沒有 set
      writeFileSync(join(d, 'meta.json'), JSON.stringify({ task: 'grade.apply', date: '2026-09-02', mode: 'fake' }));
      writeFileSync(join(d, 'demo-1.output.json'), JSON.stringify({ id: 'demo-1', text: 'x' }));
    }
    const result = await main(['--diff', dirA, dirB]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('<base>/<golden set id>/<date>');
    expect(result.output).not.toContain('- demo-1');
  });

  it('--diff 少給目錄時報錯', async () => {
    const result = await main(['--diff', 'only-one-dir']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('--diff');
  });

  it('沒有任何已知旗標時顯示用法並以非 0 結束', async () => {
    const result = await main([]);
    expect(result.code).toBe(1);
    expect(result.output).toContain('用法');
  });

  it('跑兩次 golden 再 diff,兩邊輸出都顯示出來', async () => {
    const out = tmpOutDir();
    const first = await main(['--golden', '--set', 'selftest', '--fake', '--out', out]);
    expect(first.code).toBe(0);

    // 找出剛剛寫出的目錄(golden-run.test.ts 已驗證過寫檔細節,這裡只重用它產生的路徑)
    const match = first.output.match(/→ (.+selftest\/[\d-]+)\(/);
    expect(match).toBeTruthy();
    const dir = match![1]!;
    expect(dir.startsWith(out)).toBe(true);
    expect(existsSync(dir)).toBe(true);

    const diff = await main(['--diff', dir, dir]);
    expect(diff.code).toBe(0);
    const lines = diff.output.split('\n');
    expect(lines[0]).toBe(`比對 selftest:${dir} vs ${dir}`);
    expect(lines.filter((l) => l.startsWith('- '))).toEqual(['- demo-1 (相同)', '- demo-2 (相同)', '- demo-3 (相同)']);
    // 每一項都是「一行標題 + A: + B:」三行,黏成一行就讀不出誰是誰
    const aLines = lines.filter((l) => l.startsWith('  A: '));
    expect(aLines.length).toBe(3);
    for (const l of aLines) expect(l.length).toBeGreaterThan('  A: '.length);
  });

  it('--diff 兩邊不一樣、其中一邊缺項時,標成 (不同) 並印 (缺),分數也一起顯示', async () => {
    const base = tmpOutDir();
    const mk = (date: string, outputs: Record<string, string>, scores?: string): string => {
      const dir = join(base, 'selftest', date);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({ set: 'selftest', task: 'grade.apply', date, model: 'm', provider: 'fake', promptFileGitCommit: 'x', mode: 'fake' }),
      );
      for (const [id, text] of Object.entries(outputs)) {
        writeFileSync(join(dir, `${id}.output.json`), JSON.stringify({ id, text, structural: { issues: [], note: '' } }));
      }
      if (scores) writeFileSync(join(dir, 'SCORES.md'), scores);
      return dir;
    };
    const a = mk('2026-09-10', { 'demo-1': 'A 版', 'demo-2': '只有 A 有' }, ['| id | 正確嗎 | 是一個概念嗎 |', '|---|---|---|', '| demo-1 | 5 | 4 |'].join('\n'));
    const b = mk('2026-09-11', { 'demo-1': 'B 版' });

    const diff = await main(['--diff', a, b]);
    expect(diff.code).toBe(0);
    const lines = diff.output.split('\n');
    expect(lines).toContain('- demo-1 (不同)');
    expect(lines).toContain('  A: A 版');
    expect(lines).toContain('  B: B 版');
    expect(lines).toContain('- demo-2 (不同)');
    expect(lines).toContain('  B: (缺)');
    expect(lines).toContain('  A 的分數: {"正確嗎":"5","是一個概念嗎":"4"}');
    expect(lines.filter((l) => l.startsWith('  B 的分數:'))).toEqual([]);
  });

  it('--diff 兩個目錄不是同一組 golden set 時退出碼 1', async () => {
    const base = tmpOutDir();
    const mk = (set: string): string => {
      const dir = join(base, set, '2026-09-10');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'meta.json'),
        JSON.stringify({ set, task: 'grade.apply', date: '2026-09-10', model: 'm', provider: 'fake', promptFileGitCommit: 'x', mode: 'fake' }),
      );
      return dir;
    };
    const diff = await main(['--diff', mk('selftest'), mk('ingest.cards')]);
    expect(diff.code).toBe(1);
    expect(diff.output).toContain('不能比較');
    expect(diff.output).toContain('selftest');
    expect(diff.output).toContain('ingest.cards');
  });
});
