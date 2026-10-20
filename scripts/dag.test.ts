/**
 * 13-work-dag phase-1(工單 T33)的單元與行程測試。測試 agent(-e5)寫;開發 worker 不改。
 * 被測的是 `scripts/dag.ts`:從 FEATURE.md 的 Phase 表、NEXT.md 的 gate、git tag `I<N>` 算出
 * READY / BLOCKED / HUMAN / PROBLEM 與 mermaid。規格正本:features/13-work-dag/FEATURE.md、phase-1.feature。
 *
 * ── `scripts/dag.ts` 必須匯出的純函式(測試 agent 定死,worker 照單實作;簽名在 `DagModule` 型別) ──
 *   compareNatural(a, b)        自然排序比較:數字段按數值比(任意長度,不經 Number),其餘按碼位;完全相同回 0;
 *                               數值相等但寫法不同(`01` 與 `1`)再以原字串碼位決定,讓排序全序、可重現。
 *   parsePhaseTable(featureMd)  讀出 Phase 表(表頭含「Phase」與「狀態」兩欄)的 [{ phase, status }],依檔案順序;
 *                               沒有這種表回 []。status 正規化成開頭的關鍵字 todo|ready|in-progress|done|blocked
 *                               (`todo(gate 已由 ADR-039 解除)` → `todo`);不認得的原樣(去頭尾空白)。
 *   parseGateRefs(text)         從一段 gate 文字依出現順序抽出參照:phase(raw = 原文寫法,folder = 資料夾名/兩位前綴/null=自己)、
 *                               integration(`I<N>`)、decision(`ADR-NNN`、`§N[a-z]`、`commit <hex>`)。
 *   dashItemText(line)         一行 `- 項目` / `- [ ] 項目` / `- [x] 項目` 的項目文字(縮排可有);不是清單行回 null。不把行首反引號當語法、不把行內 # 當註解(phase-2 讀工單檔頭重用它)。
 *   parseNext(nextMd)           讀 NEXT.md,依出現順序回 [{ phase, noGate, refs }]:`**phase-N**` 開頭的段落,
 *                               `無 gate` → noGate,`需要:` 後的同一行內容與緊接的 `- [ ]` / `- [x]` 項目 → refs(勾選不讀)。
 *   analyzeTree({ folders, tags })  純計算:回 { lines, edges, counts }。lines = 排好序的記錄行(不含摘要行);
 *                               edges = 排好序、不重複的 [被依賴者, 依賴者];counts = { ready, blocked, human, problems }。
 *   renderReport(analysis)      印出的全文:記錄行、mermaid 圍欄區塊、**最後一行**是摘要行;每行一個 `\n` 結尾。
 *
 * ── 輸出約定(規格沒寫死、這裡定死;worker 照做) ──
 *   - 記錄行分組順序 READY、BLOCKED、HUMAN、PROBLEM;組內以「關鍵字後面的整段文字」做自然排序。
 *   - mermaid:```mermaid、`graph TD`、每條邊一行 `    "<被依賴者>" --> "<依賴者>"`、```;只有邊,沒有節點宣告行;
 *     邊是「依賴」(每個 gate 參照一條,滿足與否都畫),決策 gate 與解不開的參照不畫;同一對只畫一條。
 *   - READY 的 `(table says <status>)` 註記:表上狀態不是 ready、而且這個 phase 有 gate 宣告(`需要:`)時才加;
 *     `無 gate` 的 phase 表上本來就是 todo,不加(phase-1.feature 的兩個場景就是這樣寫的)。
 *   - 摘要行 `gate=dag result=OK ready=<n> blocked=<n> human=<n> problems=<n>`,n 是對應記錄行的條數;有 PROBLEM 也是 result=OK。
 *   - 環:PROBLEM cycle 後面是「X -> Y -> ... -> X」,箭頭 = 「需要」;從環上自然排序最小的節點起;每個環一行。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DAG_TS = join(REPO_ROOT, 'scripts/dag.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const FIXTURE_BASIC = join(REPO_ROOT, 'features/13-work-dag/fixtures/basic');

// ───────────────────────────────────────────────────────────────────── 型別(給 tsc;實作檔還沒有時用動態 import)
type Status = 'todo' | 'ready' | 'in-progress' | 'done' | 'blocked' | string;
type GateRef =
  | { kind: 'phase'; raw: string; folder: string | null; num: number }
  | { kind: 'integration'; name: string }
  | { kind: 'decision'; ref: string };
interface Analysis {
  lines: string[];
  edges: [string, string][];
  counts: { ready: number; blocked: number; human: number; problems: number };
}
interface TreeInput {
  folders: { name: string; featureMd: string | null; nextMd: string | null }[];
  tags: string[];
}
interface DagModule {
  compareNatural(a: string, b: string): number;
  parsePhaseTable(featureMd: string): { phase: number; status: Status }[];
  parseGateRefs(text: string): GateRef[];
  parseNext(nextMd: string): { phase: number; noGate: boolean; refs: GateRef[] }[];
  dashItemText(line: string): string | null;
  analyzeTree(input: TreeInput): Analysis;
  renderReport(analysis: Analysis): string;
}

/** 載入 scripts/dag.ts;還沒有或載入失敗時,每一條用到它的測試各自紅(帶原因),不是整檔跳過 */
let loaded: DagModule | undefined;
let loadError: unknown;
beforeAll(async () => {
  try {
    loaded = (await import(pathToFileURL(DAG_TS).href)) as DagModule;
  } catch (err) {
    loadError = err;
  }
});
const dag = new Proxy({} as DagModule, {
  get(_target, name) {
    if (!loaded) throw new Error(`scripts/dag.ts 載入不了(${String(loadError instanceof Error ? loadError.message : loadError)}),用不到 ${String(name)}`);
    return loaded[name as keyof DagModule];
  },
});

// ───────────────────────────────────────────────────────────────────── 假樹的小工具
const HEAD = '| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n';
function featureMd(rows: [number, string][]): string {
  return `# x\n\n## Phase\n\n${HEAD}${rows.map(([n, s]) => `| ${n} | t${n} | Wave 0 | ${s} | |`).join('\n')}\n`;
}
interface Spec {
  rows: [number, string][];
  next?: string | null;
}
function tree(spec: Record<string, Spec>, tags: string[] = []): TreeInput {
  return {
    folders: Object.entries(spec).map(([name, s]) => ({ name, featureMd: featureMd(s.rows), nextMd: s.next ?? null })),
    tags,
  };
}
const run = (spec: Record<string, Spec>, tags: string[] = []): Analysis => dag.analyzeTree(tree(spec, tags));
const A = '01-alpha';
const B = '02-beta';
const NO_GATE = (n: number) => `**phase-${n}**:無 gate。\n`;
const NEEDS = (n: number, gate: string) => `**phase-${n}** 需要:${gate}\n`;
const keyword = (line: string) => line.split(' ')[0];
const ofKind = (a: Analysis, kw: string) => a.lines.filter((l) => keyword(l) === kw);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

// ═══════════════════════════════════════════════════════════════════ compareNatural
describe('compareNatural(自然排序)', () => {
  const sign = (n: number) => Math.sign(n);
  it('數字段按數值比:phase-2 在 phase-10 前面,T2 在 T10 前面(不是字串排序)', () => {
    expect(sign(dag.compareNatural('phase-2', 'phase-10'))).toBe(-1);
    expect(sign(dag.compareNatural('phase-10', 'phase-2'))).toBe(1);
    expect(sign(dag.compareNatural('T2', 'T10'))).toBe(-1);
    expect(sign(dag.compareNatural('x9', 'x10'))).toBe(-1);
  });
  it('完全相同回 0', () => {
    expect(dag.compareNatural('I4', 'I4')).toBe(0);
    expect(dag.compareNatural('', '')).toBe(0);
  });
  it('多段數字逐段比', () => {
    expect(sign(dag.compareNatural('a1b2', 'a1b10'))).toBe(-1);
    expect(sign(dag.compareNatural('a2b1', 'a10b1'))).toBe(-1);
  });
  it('數字比字母前面,字母按碼位(大寫在小寫前面)', () => {
    expect(sign(dag.compareNatural('01-alpha/phase-1', 'I4'))).toBe(-1);
    expect(sign(dag.compareNatural('B', 'a'))).toBe(-1);
    expect(sign(dag.compareNatural('a', 'B'))).toBe(1);
  });
  it('前綴短的在前', () => {
    expect(sign(dag.compareNatural('phase', 'phase-1'))).toBe(-1);
    expect(sign(dag.compareNatural('phase-1', 'phase'))).toBe(1);
  });
  it('數值相等但寫法不同(01 與 1):不回 0,而且兩個方向相反(全序)', () => {
    const ab = sign(dag.compareNatural('01', '1'));
    expect(ab).not.toBe(0);
    expect(sign(dag.compareNatural('1', '01'))).toBe(-ab);
  });
  it('超過 2^53 的長數字也要按數值比(不經 Number)', () => {
    expect(sign(dag.compareNatural('x99999999999999999999', 'x100000000000000000000'))).toBe(-1);
    expect(sign(dag.compareNatural('x100000000000000000000', 'x99999999999999999999'))).toBe(1);
  });
  it('排一串:T1 T2 T3b T10 T20', () => {
    const shuffled = ['T20', 'T3b', 'T10', 'T1', 'T2'];
    expect([...shuffled].sort(dag.compareNatural)).toEqual(['T1', 'T2', 'T3b', 'T10', 'T20']);
  });
});

// ═══════════════════════════════════════════════════════════════════ parsePhaseTable
describe('parsePhaseTable(Phase 表)', () => {
  it('依檔案順序讀出 phase 編號與狀態', () => {
    expect(dag.parsePhaseTable(featureMd([[1, 'done'], [2, 'ready'], [3, 'todo']]))).toEqual([
      { phase: 1, status: 'done' },
      { phase: 2, status: 'ready' },
      { phase: 3, status: 'todo' },
    ]);
  });
  it('五種狀態都認得;in-progress 的連字號保留', () => {
    const rows = dag.parsePhaseTable(featureMd([[1, 'todo'], [2, 'ready'], [3, 'in-progress'], [4, 'done'], [5, 'blocked']]));
    expect(rows.map((r) => r.status)).toEqual(['todo', 'ready', 'in-progress', 'done', 'blocked']);
  });
  it('沒有 Phase 表回 []', () => {
    expect(dag.parsePhaseTable('# 03 · gamma\n\n## 一句話\n\n沒有表。\n')).toEqual([]);
    expect(dag.parsePhaseTable('')).toEqual([]);
  });
  it('只有表頭沒有資料列回 []', () => {
    expect(dag.parsePhaseTable(`# x\n\n${HEAD}`)).toEqual([]);
  });
  it('表頭欄位順序不同也讀得到(用表頭找「狀態」欄,不寫死第 4 欄)', () => {
    const md = '| Phase | 狀態 | 標題 |\n|---|---|---|\n| 1 | done | 第一個 |\n| 2 | todo | 第二個 |\n';
    expect(dag.parsePhaseTable(md)).toEqual([
      { phase: 1, status: 'done' },
      { phase: 2, status: 'todo' },
    ]);
  });
  it('另一張表頭是 Phase 但沒有「狀態」欄的表(依賴表)不算 Phase 表', () => {
    const md = `# x\n\n| Phase | 需要 | 原因 |\n|---|---|---|\n| 2 | phase-1 | 因為 |\n\n${HEAD}| 1 | t | Wave 0 | done | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }]);
  });
  it('狀態格後面跟註解:`todo(gate 已由 ADR-039 解除)` 讀成 todo', () => {
    const rows = dag.parsePhaseTable(featureMd([[1, 'todo(gate 已由 ADR-039 解除)'], [2, 'done']]));
    expect(rows).toEqual([
      { phase: 1, status: 'todo' },
      { phase: 2, status: 'done' },
    ]);
  });
  it('不認得的狀態原樣保留,不被誤讀成認得的那五種', () => {
    const rows = dag.parsePhaseTable(featureMd([[1, 'wip']]));
    expect(rows).toEqual([{ phase: 1, status: 'wip' }]);
  });
  it('分隔列與第一格不是整數的列略過', () => {
    const md = `${HEAD}| 1 | t | Wave 0 | done | |\n| x | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }]);
  });
  it('兩位數的 phase 編號讀成數值', () => {
    expect(dag.parsePhaseTable(featureMd([[10, 'todo']]))).toEqual([{ phase: 10, status: 'todo' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════ parseGateRefs
describe('parseGateRefs(gate 文字裡的參照)', () => {
  it('三種 phase 寫法:資料夾全名/phase-N、NN phase-N、單獨 phase-N', () => {
    expect(dag.parseGateRefs('01-alpha/phase-1 `done`')).toEqual([{ kind: 'phase', raw: '01-alpha/phase-1', folder: '01-alpha', num: 1 }]);
    expect(dag.parseGateRefs('01 phase-1 `done`')).toEqual([{ kind: 'phase', raw: '01 phase-1', folder: '01', num: 1 }]);
    expect(dag.parseGateRefs('phase-1 `done`')).toEqual([{ kind: 'phase', raw: 'phase-1', folder: null, num: 1 }]);
  });
  it('兩位數 phase 編號整個讀(phase-10 不是 phase-1)', () => {
    expect(dag.parseGateRefs('phase-10 `done`')).toEqual([{ kind: 'phase', raw: 'phase-10', folder: null, num: 10 }]);
    expect(dag.parseGateRefs('03-llm-router/phase-12 `done`')).toEqual([{ kind: 'phase', raw: '03-llm-router/phase-12', folder: '03-llm-router', num: 12 }]);
  });
  it('資料夾全名/phase-N 只算一條,不會再被當成「單獨 phase-N」重複抽出', () => {
    expect(dag.parseGateRefs('02-ingest-pipeline/phase-3 `done`')).toHaveLength(1);
    expect(dag.parseGateRefs('05 phase-3 `done`')).toHaveLength(1);
  });
  it('整合點:**I4 通過**、I2 自動驗收通過,I 後面接整串數字', () => {
    expect(dag.parseGateRefs('**I4 通過**')).toEqual([{ kind: 'integration', name: 'I4' }]);
    expect(dag.parseGateRefs('phase-1 done、I2 自動驗收通過')).toEqual([
      { kind: 'phase', raw: 'phase-1', folder: null, num: 1 },
      { kind: 'integration', name: 'I2' },
    ]);
    expect(dag.parseGateRefs('**I10 通過**')).toEqual([{ kind: 'integration', name: 'I10' }]);
  });
  it('像 I4 但不是整合點的字不算:i4-integration-wiring、XI4、PI4x', () => {
    expect(dag.parseGateRefs('i4-integration-wiring')).toEqual([]);
    expect(dag.parseGateRefs('XI4')).toEqual([]);
    expect(dag.parseGateRefs('MI4N')).toEqual([]);
    expect(dag.parseGateRefs('I4x I2abc')).toEqual([]);
  });
  it('決策 gate:ADR-NNN、§N、§11b、七碼以上 hex(輸出成 commit <hex>)', () => {
    expect(dag.parseGateRefs('ADR-040 已決定')).toEqual([{ kind: 'decision', ref: 'ADR-040' }]);
    expect(dag.parseGateRefs('§13 已決定')).toEqual([{ kind: 'decision', ref: '§13' }]);
    expect(dag.parseGateRefs('§11b 已決定')).toEqual([{ kind: 'decision', ref: '§11b' }]);
    expect(dag.parseGateRefs('9a8b7c6 已決定')).toEqual([{ kind: 'decision', ref: 'commit 9a8b7c6' }]);
    expect(dag.parseGateRefs('9a8b7c6d5e4f 已決定')).toEqual([{ kind: 'decision', ref: 'commit 9a8b7c6d5e4f' }]);
  });
  it('hex 要七碼以上,而且同時有數字與 a–f 字母:六碼、全數字、全字母、日期、一般英文字都不是 commit', () => {
    expect(dag.parseGateRefs('9a8b7c 與 1234567 與 abcdefa 與 effaced 與 2026-10-15 與 decade')).toEqual([]);
  });
  it('「無」或沒有參照的文字回 []', () => {
    expect(dag.parseGateRefs('無')).toEqual([]);
    expect(dag.parseGateRefs('')).toEqual([]);
    expect(dag.parseGateRefs('一台 Wayland 機器')).toEqual([]);
  });
  it('依出現順序,以、分隔的一整句', () => {
    expect(dag.parseGateRefs('phase-1 `done`、01 phase-1 `done`、**I4 通過**、ADR-040')).toEqual([
      { kind: 'phase', raw: 'phase-1', folder: null, num: 1 },
      { kind: 'phase', raw: '01 phase-1', folder: '01', num: 1 },
      { kind: 'integration', name: 'I4' },
      { kind: 'decision', ref: 'ADR-040' },
    ]);
  });
  it('反引號與粗體包著也抽得到;ADR 後面沒有數字不算', () => {
    expect(dag.parseGateRefs('`ADR-065` accepted')).toEqual([{ kind: 'decision', ref: 'ADR-065' }]);
    expect(dag.parseGateRefs('ADR- 與 ADR-x')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════ parseNext
describe('parseNext(NEXT.md 的 gate 宣告)', () => {
  it('`**phase-N**:無 gate` → noGate,沒有參照;後面的說明文字裡的參照不算', () => {
    expect(dag.parseNext('**phase-1**:無 gate。placeholder only, touches no core。\n')).toEqual([{ phase: 1, noGate: true, refs: [] }]);
    expect(dag.parseNext('**phase-1**:無 gate。只依賴 `contracts/`,不用等 phase-2 `done`、ADR-040。\n')).toEqual([{ phase: 1, noGate: true, refs: [] }]);
  });
  it('同一行的 `需要:`:參照依序抽出,phase 標記本身(**phase-2**)不算參照', () => {
    expect(dag.parseNext('**phase-2** 需要:phase-1 `done`\n')).toEqual([
      { phase: 2, noGate: false, refs: [{ kind: 'phase', raw: 'phase-1', folder: null, num: 1 }] },
    ]);
    expect(dag.parseNext('**phase-4** 需要:phase-3 `done`、05 phase-3 `done`、**I4 通過**\n')).toEqual([
      {
        phase: 4,
        noGate: false,
        refs: [
          { kind: 'phase', raw: 'phase-3', folder: null, num: 3 },
          { kind: 'phase', raw: '05 phase-3', folder: '05', num: 3 },
          { kind: 'integration', name: 'I4' },
        ],
      },
    ]);
  });
  it('`需要:` 後面接 checklist:每一項都是 gate 宣告,`- [x]` 也讀(勾選不讀);`整合:無` 沒有參照', () => {
    const md = '**phase-2** 需要:\n- [ ] 自身:phase-1 `done`\n- [ ] 整合:無\n- [x] 決策:ADR-065 accepted(2026-10-15,技術顧問)\n';
    expect(dag.parseNext(md)).toEqual([
      {
        phase: 2,
        noGate: false,
        refs: [
          { kind: 'phase', raw: 'phase-1', folder: null, num: 1 },
          { kind: 'decision', ref: 'ADR-065' },
        ],
      },
    ]);
  });
  it('勾選的項目與沒勾的項目,抽出的參照完全一樣', () => {
    const ticked = dag.parseNext('**phase-2** 需要:\n- [x] 自身:phase-1 `done`\n');
    const open = dag.parseNext('**phase-2** 需要:\n- [ ] 自身:phase-1 `done`\n');
    expect(ticked).toEqual(open);
    expect(ticked[0]?.refs).toHaveLength(1);
  });
  it('多個 phase 的宣告,依出現順序各一筆', () => {
    const md = '# 01 · alpha — 下一步\n\n## Gate\n\n**phase-1**:無 gate。\n\n**phase-2** 需要:phase-1 `done`\n\n**phase-3** 需要:phase-2 `done`、**I4 通過**\n';
    expect(dag.parseNext(md).map((e) => [e.phase, e.noGate, e.refs.length])).toEqual([
      [1, true, 0],
      [2, false, 1],
      [3, false, 2],
    ]);
  });
  it('宣告段落到空白行就結束:後面段落、其他章節裡提到的 phase / ADR 不算這個 phase 的 gate', () => {
    const md = '**phase-2** 需要:\n- [ ] 自身:phase-1 `done`\n\n## Gate 未滿足時\n\n**phase-2 等 phase-3 `done`、ADR-999。** 這段是說明。\n- [ ] 說明裡的清單 phase-9 `done`\n';
    expect(dag.parseNext(md)).toEqual([{ phase: 2, noGate: false, refs: [{ kind: 'phase', raw: 'phase-1', folder: null, num: 1 }] }]);
  });
  it('只有標題、沒有任何宣告 → []', () => {
    expect(dag.parseNext('# 01 · alpha — next steps\n')).toEqual([]);
    expect(dag.parseNext('')).toEqual([]);
  });
  it('`需要:` 但整句只有「無」→ 有一筆宣告、沒有參照', () => {
    const entries = dag.parseNext('**phase-2** 需要:無\n');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.phase).toBe(2);
    expect(entries[0]?.refs).toEqual([]);
  });
  it('兩位數 phase 編號', () => {
    expect(dag.parseNext('**phase-12** 需要:phase-11 `done`\n')).toEqual([
      { phase: 12, noGate: false, refs: [{ kind: 'phase', raw: 'phase-11', folder: null, num: 11 }] },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════ analyzeTree:READY / BLOCKED
describe('analyzeTree:phase 開不開得了工', () => {
  const two = (s1: string, s2 = 'todo'): Record<string, Spec> => ({
    [A]: { rows: [[1, s1], [2, s2]], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') },
  });
  it('前一個 done → READY;表上是 todo 加 (table says todo)', () => {
    expect(run(two('done')).lines).toContain(`READY ${A}/phase-2 (table says todo)`);
  });
  it('前一個 done、表上是 ready → READY 不加註記', () => {
    const a = run(two('done', 'ready'));
    expect(a.lines).toContain(`READY ${A}/phase-2`);
    expect(a.lines.some((l) => l.includes('table says'))).toBe(false);
  });
  it.each(['in-progress', 'todo', 'ready', 'blocked'])('前一個是 %s → BLOCKED by 前一個', (s) => {
    const a = run(two(s));
    expect(a.lines).toContain(`BLOCKED ${A}/phase-2 by ${A}/phase-1`);
    expect(a.lines.some((l) => l === `READY ${A}/phase-2` || l.startsWith(`READY ${A}/phase-2 `))).toBe(false);
  });
  it.each(['in-progress', 'done'])('自己是 %s:不出 READY、BLOCKED、HUMAN,也不報 gate-not-declared', (s) => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, s]], next: NEEDS(2, 'phase-1 `done`') } });
    expect(a.lines.filter((l) => l.includes(`${A}/phase-2`))).toEqual([]);
    expect(a.counts).toEqual({ ready: 0, blocked: 0, human: 0, problems: 0 });
  });
  it('in-progress / done 即使 gate 沒滿足、沒有 NEXT.md 也不列', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'in-progress'], [3, 'done']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') } });
    expect(a.lines.filter((l) => l.includes('phase-2') || l.includes('phase-3'))).toEqual([]);
    const b = run({ [A]: { rows: [[1, 'in-progress'], [2, 'done']], next: null } });
    expect(b.lines).toEqual([]);
  });
  it('表上是 blocked:gate 滿足了照樣 BLOCKED by status:blocked,不出 READY', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'blocked']], next: NEEDS(2, 'phase-1 `done`') } });
    expect(a.lines).toContain(`BLOCKED ${A}/phase-2 by status:blocked`);
    expect(ofKind(a, 'READY')).toEqual([]);
    expect(a.counts.blocked).toBe(1);
  });
  it('只列直接擋住的:p3 需要 p2、p2 需要 p1(都沒做)→ p1 READY、p2 BLOCKED by p1、p3 BLOCKED by p2', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo'], [3, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`') } });
    expect(a.lines).toEqual([`READY ${A}/phase-1`, `BLOCKED ${A}/phase-2 by ${A}/phase-1`, `BLOCKED ${A}/phase-3 by ${A}/phase-2`]);
  });
  it('已滿足的依賴不出現在 by 後面,只列沒滿足的', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo'], [3, 'todo']], next: NO_GATE(1) + NO_GATE(2) + NEEDS(3, 'phase-1 `done`、phase-2 `done`') } });
    expect(a.lines).toContain(`BLOCKED ${A}/phase-3 by ${A}/phase-2`);
  });
  it('「無 gate」的 todo phase 直接 READY,不加表上狀態註記;有 gate 的 todo phase 才加', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } });
    expect(a.lines).toEqual([`READY ${A}/phase-1`]);
    expect(a.counts).toEqual({ ready: 1, blocked: 0, human: 0, problems: 0 });
  });
  it('`需要:` 但只有「無」的 phase:有宣告、沒有擋住的人 → READY', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: '**phase-1** 需要:無\n' } });
    expect(ofKind(a, 'READY')).toHaveLength(1);
    expect(ofKind(a, 'PROBLEM')).toEqual([]);
  });
  it('三種 phase 寫法指到同一個節點', () => {
    const base = { [A]: { rows: [[1, 'todo']] as [number, string][], next: NO_GATE(1) }, [B]: { rows: [[1, 'todo'], [2, 'todo']] as [number, string][] } };
    for (const [gate, by] of [['01-alpha/phase-1 `done`', `${A}/phase-1`], ['01 phase-1 `done`', `${A}/phase-1`], ['phase-1 `done`', `${B}/phase-1`]] as const) {
      const a = run({ ...base, [B]: { ...base[B], next: NO_GATE(1) + NEEDS(2, gate) } });
      expect(a.lines, gate).toContain(`BLOCKED ${B}/phase-2 by ${by}`);
    }
  });
  it('同一個依賴寫兩次:by 只列一次,邊只畫一條', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`、01 phase-1 `done`') } });
    expect(a.lines).toContain(`BLOCKED ${A}/phase-2 by ${A}/phase-1`);
    expect(a.edges).toEqual([[`${A}/phase-1`, `${A}/phase-2`]]);
  });
  it('勾選框不讀:- [x] 的項目照樣算沒滿足', () => {
    const a = run({ [A]: { rows: [[1, 'in-progress'], [2, 'todo']], next: `**phase-2** 需要:\n- [x] 自身:phase-1 \`done\`\n- [ ] 整合:無\n` } });
    expect(a.lines).toContain(`BLOCKED ${A}/phase-2 by ${A}/phase-1`);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('跨資料夾:02-beta/phase-2 需要 01 phase-3', () => {
    const a = run({
      [A]: { rows: [[1, 'done'], [2, 'ready'], [3, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`') },
      [B]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, '01 phase-3 `done`') },
    });
    expect(a.lines).toEqual([`READY ${A}/phase-2`, `BLOCKED ${A}/phase-3 by ${A}/phase-2`, `BLOCKED ${B}/phase-2 by ${A}/phase-3`]);
    expect(a.counts).toEqual({ ready: 1, blocked: 2, human: 0, problems: 0 });
  });
  it('沒有 NEXT.md 的資料夾:todo / ready 的 phase 都報 gate-not-declared', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo'], [3, 'ready'], [4, 'in-progress']], next: null } });
    expect(a.lines).toEqual([`PROBLEM gate-not-declared ${A}/phase-2`, `PROBLEM gate-not-declared ${A}/phase-3`]);
  });
  it('NEXT.md 沒寫到這個 phase:gate-not-declared,不猜它能開工', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo']], next: '# 01 · alpha — next steps\n' } });
    expect(a.lines).toEqual([`PROBLEM gate-not-declared ${A}/phase-2`]);
    expect(a.counts).toEqual({ ready: 0, blocked: 0, human: 0, problems: 1 });
  });
  it('只有別的 phase 有宣告:沒宣告的那個 phase 仍然 gate-not-declared', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NO_GATE(1) } });
    expect(a.lines).toEqual([`READY ${A}/phase-1`, `PROBLEM gate-not-declared ${A}/phase-2`]);
  });
});

// ═══════════════════════════════════════════════════════════════════ analyzeTree:整合點
describe('analyzeTree:整合點 I<N> 只認完全相同的 tag', () => {
  const spec: Record<string, Spec> = { [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, 'phase-1 `done`、**I4 通過**') } };
  it.each([['i4-integration-wiring'], ['I40'], ['XI4'], ['i4'], ['I4-wip'], ['I'], ['4'], ['I4 ']])('只有 tag %j → 仍 BLOCKED by I4', (tag) => {
    const a = run(spec, [tag]);
    expect(a.lines).toContain(`BLOCKED ${A}/phase-2 by I4`);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('沒有任何 tag → BLOCKED by I4', () => {
    expect(run(spec, []).lines).toContain(`BLOCKED ${A}/phase-2 by I4`);
  });
  it('有 tag I4(混在別的 tag 裡)→ READY', () => {
    const a = run(spec, ['v1', 'I3', 'I4', 'i4-x']);
    expect(a.lines).toContain(`READY ${A}/phase-2 (table says todo)`);
    expect(ofKind(a, 'BLOCKED')).toEqual([]);
  });
  it('兩個整合點:I4 有、I5 沒有 → 只擋在 I5', () => {
    const s: Record<string, Spec> = { [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, '**I4 通過**、**I5 通過**') } };
    expect(run(s, ['I4']).lines).toContain(`BLOCKED ${A}/phase-2 by I5`);
  });
  it('phase 與整合點都沒滿足:by 後面以逗號相接,依自然排序(01-alpha/phase-1 在 I4 前面)', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: NO_GATE(1) }, [B]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`、01 phase-1 `done`、**I4 通過**') } });
    expect(a.lines).toContain(`BLOCKED ${B}/phase-2 by ${A}/phase-1,I4`);
  });
  it('by 後面的順序不看 gate 裡寫的順序(I4 寫在前面也排在後面)', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: NO_GATE(1) }, [B]: { rows: [[1, 'todo']], next: NEEDS(1, '**I4 通過**、01 phase-1 `done`') } });
    expect(a.lines).toContain(`BLOCKED ${B}/phase-1 by ${A}/phase-1,I4`);
  });
  it('by 的自然排序:phase-2 在 phase-10 前面', () => {
    const rows: [number, string][] = [[2, 'todo'], [10, 'todo'], [11, 'todo']];
    const a = run({ [A]: { rows, next: NO_GATE(2) + NO_GATE(10) + NEEDS(11, 'phase-10 `done`、phase-2 `done`') } });
    expect(a.lines).toContain(`BLOCKED ${A}/phase-11 by ${A}/phase-2,${A}/phase-10`);
  });
});

// ═══════════════════════════════════════════════════════════════════ analyzeTree:決策 gate
describe('analyzeTree:決策 gate 只出 HUMAN,不猜', () => {
  const one = (gate: string): Analysis => run({ [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, gate) } });
  it.each([
    ['ADR-040 已決定', 'ADR-040'],
    ['§13 已決定', '§13'],
    ['§11b 已決定', '§11b'],
    ['9a8b7c6 已決定', 'commit 9a8b7c6'],
  ])('phase-1 `done`、%s → HUMAN,不是 READY', (rest, shown) => {
    const a = one(`phase-1 \`done\`、${rest}`);
    expect(a.lines).toEqual([`HUMAN ${A}/phase-2 decision ${shown}`]);
    expect(a.counts).toEqual({ ready: 0, blocked: 0, human: 1, problems: 0 });
  });
  it('決策 gate 不畫成邊;其他 gate 的邊照畫', () => {
    expect(one('phase-1 `done`、ADR-040 已決定').edges).toEqual([[`${A}/phase-1`, `${A}/phase-2`]]);
  });
  it('一個節點兩個決策 gate:各一行 HUMAN,依自然排序', () => {
    const a = one('phase-1 `done`、ADR-041、ADR-040');
    expect(a.lines).toEqual([`HUMAN ${A}/phase-2 decision ADR-040`, `HUMAN ${A}/phase-2 decision ADR-041`]);
    expect(a.counts.human).toBe(2);
  });
  it('只有決策 gate、沒有其他依賴 → 一樣 HUMAN', () => {
    expect(one('ADR-040 已決定').lines).toEqual([`HUMAN ${A}/phase-2 decision ADR-040`]);
  });
  it('決策 gate 加上沒滿足的依賴:不 READY', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`、ADR-040') } });
    expect(ofKind(a, 'READY').filter((l) => l.includes('phase-2'))).toEqual([]);
  });
  it('checklist 裡的決策項(`- [x] 決策:ADR-065 accepted`)也是 HUMAN,勾了也一樣', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo']], next: '**phase-2** 需要:\n- [ ] 自身:phase-1 `done`\n- [ ] 整合:無\n- [x] 決策:ADR-065 accepted(2026-10-15,技術顧問)\n' } });
    expect(a.lines).toEqual([`HUMAN ${A}/phase-2 decision ADR-065`]);
  });
});

// ═══════════════════════════════════════════════════════════════════ analyzeTree:PROBLEM
describe('analyzeTree:PROBLEM(工具照樣往下走)', () => {
  it('引用不存在的 phase:PROBLEM unresolved-ref <node> <原文寫法>;該節點不 READY 也不 BLOCKED;其他節點照常', () => {
    const a = run({
      [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, '09 phase-7 `done`') },
      [B]: { rows: [[1, 'todo']], next: NO_GATE(1) },
    });
    expect(a.lines).toEqual([`READY ${B}/phase-1`, `PROBLEM unresolved-ref ${A}/phase-2 09 phase-7`]);
    expect(a.counts).toEqual({ ready: 1, blocked: 0, human: 0, problems: 1 });
  });
  it('引用資料夾全名、單獨 phase-N 但不存在:原文寫法照印', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, '09-gamma/phase-7 `done`、phase-9 `done`') } });
    expect(a.lines).toEqual([`READY ${A}/phase-1`, `PROBLEM unresolved-ref ${A}/phase-2 09-gamma/phase-7`, `PROBLEM unresolved-ref ${A}/phase-2 phase-9`]);
  });
  it('資料夾在、phase 編號不在,也是 unresolved-ref', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-4 `done`') } });
    expect(a.lines).toEqual([`PROBLEM unresolved-ref ${A}/phase-1 01 phase-4`]);
  });
  it('一個解不開的參照加一個正常的依賴:正常的依賴仍然畫邊,解不開的不畫', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`、09 phase-7 `done`') } });
    expect(a.edges).toEqual([[`${A}/phase-1`, `${A}/phase-2`]]);
    expect(ofKind(a, 'PROBLEM')).toEqual([`PROBLEM unresolved-ref ${A}/phase-2 09 phase-7`]);
  });
  it('資料夾沒有 Phase 表:PROBLEM no-phase-table <folder>;其他資料夾照讀', () => {
    const a = dag.analyzeTree({
      folders: [
        { name: A, featureMd: featureMd([[1, 'todo']]), nextMd: NO_GATE(1) },
        { name: '03-gamma', featureMd: '# 03 · gamma\n\n沒有表\n', nextMd: NO_GATE(1) },
      ],
      tags: [],
    });
    expect(a.lines).toEqual([`READY ${A}/phase-1`, 'PROBLEM no-phase-table 03-gamma']);
    expect(a.counts).toEqual({ ready: 1, blocked: 0, human: 0, problems: 1 });
  });
  it('FEATURE.md 不存在(featureMd 是 null)也是 no-phase-table', () => {
    const a = dag.analyzeTree({ folders: [{ name: '03-gamma', featureMd: null, nextMd: null }], tags: [] });
    expect(a.lines).toEqual(['PROBLEM no-phase-table 03-gamma']);
  });
  it('沒有 Phase 表的資料夾,它的 phase 不能被別人引用到:unresolved-ref', () => {
    const a = dag.analyzeTree({
      folders: [
        { name: A, featureMd: featureMd([[1, 'todo']]), nextMd: NEEDS(1, '03 phase-1 `done`') },
        { name: '03-gamma', featureMd: '# nothing', nextMd: null },
      ],
      tags: [],
    });
    expect(a.lines).toEqual([`PROBLEM no-phase-table 03-gamma`, `PROBLEM unresolved-ref ${A}/phase-1 03 phase-1`]);
  });
});

describe('analyzeTree:環', () => {
  const cyc2: Record<string, Spec> = {
    [A]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, '02 phase-2 `done`') },
    [B]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, '01 phase-2 `done`') },
  };
  it('兩個節點的環:報一次,從自然排序最小的節點起,箭頭是「需要」', () => {
    const a = run(cyc2);
    expect(ofKind(a, 'PROBLEM')).toEqual([`PROBLEM cycle ${A}/phase-2 -> ${B}/phase-2 -> ${A}/phase-2`]);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('三個節點的環 A→B→C→A:方向是「需要」的方向,起點是最小的節點', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '03 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual(['PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 03-c/phase-1 -> 01-a/phase-1']);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('輸入順序顛倒,環的寫法不變(起點固定)', () => {
    const forward = run(cyc2);
    const reversed = run({ [B]: cyc2[B]!, [A]: cyc2[A]! });
    expect(reversed.lines).toEqual(forward.lines);
  });
  it('自己需要自己:一個節點的環', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, 'phase-2 `done`') } });
    expect(ofKind(a, 'PROBLEM')).toEqual([`PROBLEM cycle ${A}/phase-2 -> ${A}/phase-2`]);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('兩個互不相干的環:各報一次', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '04 phase-1 `done`') },
      '04-d': { rows: [[1, 'todo']], next: NEEDS(1, '03 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual(['PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 01-a/phase-1', 'PROBLEM cycle 03-c/phase-1 -> 04-d/phase-1 -> 03-c/phase-1']);
  });
  it('環外的節點需要環上的節點:不 READY,環只報一次', () => {
    const a = run({
      ...cyc2,
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-2 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toHaveLength(1);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('進入環的路徑不是從環上最小的節點開始(01-a 需要 03-c,02-b 與 03-c 互相需要):環仍從環上最小的節點起寫', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '03 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '03 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual(['PROBLEM cycle 02-b/phase-1 -> 03-c/phase-1 -> 02-b/phase-1']);
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('環外的節點名字排在環前面也一樣:環只報一次', () => {
    const a = run({
      '00-tail': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual(['PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 01-a/phase-1']);
  });
  it('菱形依賴(不是環)不報 cycle', () => {
    const a = run({
      '01-a': { rows: [[1, 'done']], next: NO_GATE(1) },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
      '04-d': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`、03 phase-1 `done`') },
    });
    expect(a.lines.filter((l) => l.startsWith('PROBLEM'))).toEqual([]);
    expect(a.lines).toContain('BLOCKED 04-d/phase-1 by 02-b/phase-1,03-c/phase-1');
  });
  it('環畫出的邊照樣在 edges 裡(每個依賴一條)', () => {
    expect(run(cyc2).edges).toEqual([
      [`${A}/phase-2`, `${B}/phase-2`],
      [`${B}/phase-2`, `${A}/phase-2`],
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════ analyzeTree:排序、計數、邊
describe('analyzeTree:排序、摘要計數、邊', () => {
  it('記錄行分組:READY、BLOCKED、HUMAN、PROBLEM;組內自然排序(phase-2 在 phase-10 前面)', () => {
    const rows: [number, string][] = [[1, 'todo'], [2, 'todo'], [10, 'todo'], [11, 'todo'], [12, 'todo'], [13, 'todo']];
    const a = run({
      '10-zeta': { rows: [[1, 'todo']], next: NO_GATE(1) },
      '02-beta': { rows: [[1, 'todo']], next: NO_GATE(1) },
      [A]: {
        rows,
        next: NO_GATE(1) + NO_GATE(2) + NO_GATE(10) + NEEDS(11, '**I9 通過**') + NEEDS(12, 'ADR-040') + '',
      },
    });
    const reversedOrder = run({
      [A]: { rows: [...rows].reverse(), next: NO_GATE(1) + NO_GATE(2) + NO_GATE(10) + NEEDS(11, '**I9 通過**') + NEEDS(12, 'ADR-040') + '' },
      '02-beta': { rows: [[1, 'todo']], next: NO_GATE(1) },
      '10-zeta': { rows: [[1, 'todo']], next: NO_GATE(1) },
    });
    expect(reversedOrder.lines).toEqual(a.lines);
    const kinds = a.lines.map(keyword);
    expect(kinds).toEqual([...kinds].sort((x, y) => ['READY', 'BLOCKED', 'HUMAN', 'PROBLEM'].indexOf(x!) - ['READY', 'BLOCKED', 'HUMAN', 'PROBLEM'].indexOf(y!)));
    expect(ofKind(a, 'READY').map((l) => l.split(' ')[1])).toEqual([`${A}/phase-1`, `${A}/phase-2`, `${A}/phase-10`, '02-beta/phase-1', '10-zeta/phase-1']);
    expect(ofKind(a, 'PROBLEM')).toEqual([`PROBLEM gate-not-declared ${A}/phase-13`]);
  });
  it('輸入的資料夾順序、表的列順序顛倒,結果逐行相同', () => {
    const spec: Record<string, Spec> = {
      [A]: { rows: [[1, 'done'], [2, 'ready'], [3, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`、**I4 通過**') },
      [B]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, '01 phase-3 `done`、ADR-040') },
    };
    const forward = dag.renderReport(run(spec));
    const reversedSpec: Record<string, Spec> = {};
    for (const k of Object.keys(spec).reverse()) reversedSpec[k] = { ...spec[k]!, rows: [...spec[k]!.rows].reverse() };
    expect(dag.renderReport(run(reversedSpec))).toBe(forward);
  });
  it('摘要的計數等於各關鍵字的記錄行數(混合樹)', () => {
    const a = run({
      [A]: { rows: [[1, 'done'], [2, 'ready'], [3, 'todo'], [4, 'todo'], [5, 'todo'], [6, 'blocked'], [7, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`') + NEEDS(4, 'phase-1 `done`、ADR-040') + NEEDS(6, 'phase-1 `done`') + NEEDS(7, '09 phase-1 `done`') },
      '03-gamma': { rows: [], next: null },
    });
    expect(a.counts).toEqual({
      ready: ofKind(a, 'READY').length,
      blocked: ofKind(a, 'BLOCKED').length,
      human: ofKind(a, 'HUMAN').length,
      problems: ofKind(a, 'PROBLEM').length,
    });
    // phase-2 READY;phase-3 BLOCKED;phase-4 HUMAN;phase-5 gate-not-declared;phase-6 BLOCKED(status);phase-7 unresolved;gamma no-phase-table
    expect(a.counts).toEqual({ ready: 1, blocked: 2, human: 1, problems: 3 });
  });
  it('邊:每個 gate 參照一條,方向是 被依賴者 → 依賴者;滿足的依賴也畫;整合點是節點', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo'], [3, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`、**I4 通過**') } });
    expect(a.edges).toEqual([
      [`${A}/phase-1`, `${A}/phase-2`],
      [`${A}/phase-2`, `${A}/phase-3`],
      ['I4', `${A}/phase-3`],
    ]);
  });
  it('邊的排序:先依「被依賴者」自然排序,再依「依賴者」', () => {
    const rows: [number, string][] = [[1, 'done'], [10, 'todo'], [3, 'todo'], [2, 'todo']];
    const a = run({ [A]: { rows, next: NO_GATE(1) + NEEDS(10, 'phase-1 `done`') + NEEDS(3, 'phase-1 `done`') + NEEDS(2, 'phase-1 `done`') } });
    expect(a.edges.map(([f, t]) => `${f} ${t}`)).toEqual([`${A}/phase-1 ${A}/phase-2`, `${A}/phase-1 ${A}/phase-3`, `${A}/phase-1 ${A}/phase-10`]);
  });
  it('done / in-progress 的 phase 有 gate 時,邊也畫(圖是依賴,不管狀態)', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'done']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') } });
    expect(a.edges).toEqual([[`${A}/phase-1`, `${A}/phase-2`]]);
  });
  it('沒有任何邊:edges 是空陣列', () => {
    expect(run({ [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } }).edges).toEqual([]);
  });
  it('不改輸入(輸入凍結後照跑)、同一份輸入算兩次結果相同', () => {
    const input = deepFreeze(tree({ [A]: { rows: [[1, 'done'], [2, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`、**I4 通過**') } }, ['I3']));
    const first = dag.analyzeTree(input);
    const second = dag.analyzeTree(input);
    expect(second).toEqual(first);
  });
  it('空的樹:沒有記錄、沒有邊、計數全 0', () => {
    expect(dag.analyzeTree({ folders: [], tags: [] })).toEqual({ lines: [], edges: [], counts: { ready: 0, blocked: 0, human: 0, problems: 0 } });
  });
});

// ═══════════════════════════════════════════════════════════════════ renderReport
describe('renderReport(印出來的全文)', () => {
  const sample = (): Analysis =>
    run(
      {
        [A]: { rows: [[1, 'done'], [2, 'done'], [3, 'todo']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') + NEEDS(3, 'phase-2 `done`、**I4 通過**、ADR-040') },
        [B]: { rows: [[1, 'todo']], next: NO_GATE(1) },
      },
      ['I4'],
    );
  it('版面:記錄行、mermaid 圍欄、最後一行是摘要行;以 \\n 結尾', () => {
    const text = dag.renderReport(sample());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    const lines = text.split('\n').slice(0, -1);
    expect(lines).toEqual([
      `READY ${B}/phase-1`,
      `HUMAN ${A}/phase-3 decision ADR-040`,
      '```mermaid',
      'graph TD',
      `    "${A}/phase-1" --> "${A}/phase-2"`,
      `    "${A}/phase-2" --> "${A}/phase-3"`,
      `    "I4" --> "${A}/phase-3"`,
      '```',
      'gate=dag result=OK ready=1 blocked=0 human=1 problems=0',
    ]);
  });
  it('mermaid 裡沒有決策 gate 的節點', () => {
    expect(dag.renderReport(sample())).not.toContain('"ADR-040"');
  });
  it('沒有邊:mermaid 區塊只有 graph TD', () => {
    const text = dag.renderReport(run({ [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } }));
    expect(text.split('\n')).toEqual([`READY ${A}/phase-1`, '```mermaid', 'graph TD', '```', 'gate=dag result=OK ready=1 blocked=0 human=0 problems=0', '']);
  });
  it('有 PROBLEM 摘要行也是 result=OK,problems 是條數', () => {
    const text = dag.renderReport(run({ [A]: { rows: [[1, 'todo']], next: null } }));
    expect(text.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=0 blocked=0 human=0 problems=1');
  });
  it('節點 id 加雙引號(資料夾名有 - 與 /)', () => {
    const edgeLines = dag.renderReport(sample()).split('\n').filter((l) => l.includes('-->'));
    expect(edgeLines).toHaveLength(3);
    for (const l of edgeLines) expect(l).toMatch(/^ {4}"[^"]+" --> "[^"]+"$/);
  });
  it('邊數 = analysis.edges 的長度', () => {
    const a = sample();
    expect(dag.renderReport(a).split('\n').filter((l) => l.includes('-->'))).toHaveLength(a.edges.length);
  });
});

// ═══════════════════════════════════════════════════════════════════ 行程:真的跑 scripts/dag.ts
function runDag(args: string[], opts: { cwd?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [TSX_CLI, DAG_TS, ...args], { cwd: opts.cwd ?? REPO_ROOT, encoding: 'utf8', env, timeout: 60_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const scratch: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`));
  scratch.push(d);
  return d;
}
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
/** 把內建 fixture 複製到暫存目錄再跑:被測的工具若寫檔,不會弄髒 repo 裡的 fixture(那會讓「只讀」測試在第二次跑時看不出來) */
function copyFixture(prefix: string): string {
  const d = mkTmp(prefix);
  cpSync(FIXTURE_BASIC, d, { recursive: true });
  return d;
}
function writeTree(root: string, spec: Record<string, Spec>): void {
  for (const [name, s] of Object.entries(spec)) {
    const dir = join(root, 'features', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'FEATURE.md'), featureMd(s.rows));
    if (s.next != null) writeFileSync(join(dir, 'NEXT.md'), s.next);
  }
}
function gitInit(root: string, tags: string[]): void {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', root, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  for (const t of tags) git('tag', t);
}
/** 每個檔的相對路徑 → sha256(含 .git 與空目錄);用來比「前後一模一樣」 */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = relative(root, p);
      if (statSync(p).isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(p);
      } else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

describe('scripts/dag.ts 當指令跑', () => {
  it('用法錯誤退出碼 2、錯誤訊息在 stderr、stdout 沒有摘要行:沒有參數 / 不存在的根 / 空資料夾 / 沒有 features / 未知旗標 / --root 沒給值', () => {
    const empty = mkTmp('dag-empty');
    const cases: [string[], string][] = [
      [[], 'Usage:'],
      [['--root', '/nonexistent-dag-root'], 'root not found'],
      [['--root', empty], 'no features directory'],
      [['--bogus'], 'Usage:'],
      [['--root'], 'Usage:'],
      [['--check', '--root', copyFixture('dag-check')], 'Usage:'],
    ];
    for (const [args, message] of cases) {
      const r = runDag(args);
      expect(r.status, `${args.join(' ')}\n${r.stderr}`).toBe(2);
      expect(r.stderr, args.join(' ')).toContain(message);
      expect(r.stdout, args.join(' ')).not.toContain('gate=dag');
    }
  }, 120_000);

  it('沒有測試專用的縫:不認 --tags / --no-git 之類的旗標(用法錯誤)', () => {
    for (const flag of [['--tags', 'I4'], ['--no-git'], ['--skip-git']]) {
      expect(runDag([...flag, '--root', copyFixture('dag-seam')]).status, flag.join(' ')).toBe(2);
    }
  }, 60_000);

  it('內建 fixture basic:READY 1 / BLOCKED 2、摘要行、mermaid 三條邊;退出碼 0、stderr 空', () => {
    const r = runDag(['--root', copyFixture('dag-basic')]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.split('\n');
    expect(lines).toContain('READY 01-alpha/phase-2');
    expect(lines).toContain('BLOCKED 01-alpha/phase-3 by 01-alpha/phase-2');
    expect(lines).toContain('BLOCKED 02-beta/phase-2 by 01-alpha/phase-3');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=2 human=0 problems=0');
    expect(lines.filter((l) => l.includes('-->'))).toEqual([
      '    "01-alpha/phase-1" --> "01-alpha/phase-2"',
      '    "01-alpha/phase-2" --> "01-alpha/phase-3"',
      '    "01-alpha/phase-3" --> "02-beta/phase-2"',
    ]);
  }, 60_000);

  it('PROBLEM(環、解不開的參照)不讓退出碼變非 0,輸出沒有 Error / stack trace', () => {
    const root = mkTmp('dag-problem');
    writeTree(root, {
      [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NEEDS(1, '02 phase-1 `done`') + NEEDS(2, '09 phase-7 `done`') },
      [B]: { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    mkdirSync(join(root, 'features/04-delta'), { recursive: true });
    writeFileSync(join(root, 'features/04-delta/FEATURE.md'), '# no table\n');
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Error|\n\s+at /);
    expect(r.stdout).toContain(`PROBLEM cycle ${A}/phase-1 -> ${B}/phase-1 -> ${A}/phase-1`);
    expect(r.stdout).toContain(`PROBLEM unresolved-ref ${A}/phase-2 09 phase-7`);
    expect(r.stdout).toContain('PROBLEM no-phase-table 04-delta');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/^gate=dag result=OK ready=0 blocked=\d+ human=0 problems=3$/);
  }, 60_000);

  it('讀真的 git tag:長得像的 tag 不解鎖,完全相同的 tag(輕量與附註)才解鎖;不是 git 工作樹也照跑', () => {
    const spec: Record<string, Spec> = { [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, 'phase-1 `done`、**I4 通過**') } };
    const lookalike = mkTmp('dag-tag-a');
    writeTree(lookalike, spec);
    gitInit(lookalike, ['i4-integration-wiring', 'I40', 'v1']);
    const a = runDag(['--root', lookalike]);
    expect(a.status).toBe(0);
    expect(a.stdout.split('\n')).toContain(`BLOCKED ${A}/phase-2 by I4`);

    const exact = mkTmp('dag-tag-b');
    writeTree(exact, spec);
    gitInit(exact, ['I4']);
    expect(runDag(['--root', exact]).stdout.split('\n')).toContain(`READY ${A}/phase-2 (table says todo)`);

    const annotated = mkTmp('dag-tag-c');
    writeTree(annotated, spec);
    gitInit(annotated, []);
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', annotated, 'tag', '-a', 'I4', '-m', 'integration'], { stdio: 'pipe' });
    expect(runDag(['--root', annotated]).stdout.split('\n')).toContain(`READY ${A}/phase-2 (table says todo)`);

    const noGit = mkTmp('dag-tag-d');
    writeTree(noGit, spec);
    const n = runDag(['--root', noGit]);
    expect(n.status).toBe(0);
    expect(n.stdout.split('\n')).toContain(`BLOCKED ${A}/phase-2 by I4`);
  }, 120_000);

  it('features/ 底下不是資料夾的項目(README.md 之類的檔)直接略過,不報 PROBLEM、不崩潰', () => {
    const root = mkTmp('dag-stray');
    writeTree(root, { [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } });
    writeFileSync(join(root, 'features/README.md'), '# features\n');
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.includes('README'))).toEqual([]);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=0 human=0 problems=0');
  }, 60_000);

  it('資料夾裡沒有 FEATURE.md:PROBLEM no-phase-table,不崩潰', () => {
    const root = mkTmp('dag-nofeature');
    mkdirSync(join(root, 'features/05-empty'), { recursive: true });
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain('PROBLEM no-phase-table 05-empty');
  }, 60_000);

  it('只讀:跑完之後整棵樹(含 .git)一個位元組都沒變、沒有多出或少掉檔案', () => {
    const root = mkTmp('dag-readonly');
    cpSync(FIXTURE_BASIC, root, { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/02-decision-map.md'), '## ADR-040 · a decision\n');
    gitInit(root, ['I1']);
    const before = snapshot(root);
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(snapshot(root)).toEqual(before);
  }, 60_000);

  it('可重現:同一棵樹跑兩次逐位元組相同;搬到另一個路徑也相同(輸出裡沒有絕對路徑、時間、亂數)', () => {
    const one = copyFixture('dag-repro-a');
    const two = copyFixture('dag-repro-b');
    const first = runDag(['--root', one]);
    const second = runDag(['--root', one]);
    const moved = runDag(['--root', two]);
    expect(first.stdout).not.toBe('');
    expect(second.stdout).toBe(first.stdout);
    expect(moved.stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain(tmpdir());
  }, 60_000);

  it('從別的目錄跑也一樣(只看 --root,不看 cwd)', () => {
    const elsewhere = mkTmp('dag-cwd');
    const fixture = copyFixture('dag-cwd-tree');
    const here = runDag(['--root', fixture]);
    const there = runDag(['--root', fixture], { cwd: elsewhere });
    expect(there.stdout).toBe(here.stdout);
    expect(there.status).toBe(0);
  }, 60_000);

  it('在真 repo 上跑:退出碼 0、沒有 Error / stack trace、有摘要行,計數等於記錄行數(不寫死預期清單)', () => {
    const gitStatus = () => execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
    const before = gitStatus();
    const r = runDag(['--root', REPO_ROOT]);
    expect(gitStatus(), '在真 repo 上跑完,工作樹多了或少了檔案(工具必須只讀)').toBe(before);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Error|\n\s+at /);
    const lines = r.stdout.trimEnd().split('\n');
    const summary = lines.at(-1)!;
    const m = /^gate=dag result=OK ready=(\d+) blocked=(\d+) human=(\d+) problems=(\d+)$/.exec(summary);
    expect(m, summary).not.toBeNull();
    const count = (kw: string) => lines.filter((l) => l.startsWith(`${kw} `)).length;
    expect([Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])]).toEqual([count('READY'), count('BLOCKED'), count('HUMAN'), count('PROBLEM')]);
    expect(lines).toContain('graph TD');
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════ T33 補測(變異測試 69.46% → 補存活點;-ed 的存活清單)
describe('dashItemText(一行清單項)', () => {
  const t = (line: string) => dag.dashItemText(line);
  it('`- 項目` 回項目文字;`- [ ]`、`- [x]`、`- [X]` 的框不算在文字裡', () => {
    expect(t('- 項目')).toBe('項目');
    expect(t('- [ ] 項目')).toBe('項目');
    expect(t('- [x] 項目')).toBe('項目');
    expect(t('- [X] 項目')).toBe('項目');
  });
  it('縮排(空白或 tab)的項目也是清單項,回的文字不含縮排', () => {
    expect(t('  - 縮排兩格')).toBe('縮排兩格');
    expect(t('\t- tab 縮排')).toBe('tab 縮排');
    expect(t('  - [ ] 縮排的框')).toBe('縮排的框');
    expect(t('   - [x] 縮排三格的勾')).toBe('縮排三格的勾');
  });
  it('`- ` 後面的空白不限一個;框後面的空白最多吃一個,框後面沒空白也行', () => {
    expect(t('-   三個空白')).toBe('三個空白');
    expect(t('- [ ]沒有空白')).toBe('沒有空白');
    expect(t('- [x]X')).toBe('X');
  });
  it('不是清單行回 null:沒有 `-`、`-` 後面沒空白、`-` 不在行首(只有空白可以在前面)、別種符號、空字串', () => {
    for (const line of ['普通文字', '-沒空白', 'a - b', 'x- y', '* 項目', '+ 項目', '-- 項目', '', '[ ] 沒有橫線', '-[ ] 框前沒空白', '  普通縮排文字']) {
      expect(t(line), JSON.stringify(line)).toBeNull();
    }
  });
  it('框裡不是空白或 x/X 的不算框:`- [y] 項目` 的文字是 `[y] 項目`(整段都是項目文字)', () => {
    expect(t('- [y] 項目')).toBe('[y] 項目');
    expect(t('- [] 項目')).toBe('[] 項目');
  });
  it('不把行首反引號當語法、不把行內 # 當註解(phase-2 讀工單檔頭的 `- 項目` 要用)', () => {
    expect(t('- `code` 開頭')).toBe('`code` 開頭');
    expect(t('- [ ] `code` 開頭')).toBe('`code` 開頭');
    expect(t('- 項目 # 不是註解')).toBe('項目 # 不是註解');
    expect(t('- 含,逗號、頓號;分號')).toBe('含,逗號、頓號;分號');
  });
  it('整行都留下:框後面的字、行內的 - 與 [ ] 都不被吃掉', () => {
    expect(t('- 前 - 中 [ ] 後')).toBe('前 - 中 [ ] 後');
    expect(t('- [ ] 前 [x] 後')).toBe('前 [x] 後');
  });
});

describe('parseNext:清單項與續行(補測)', () => {
  const refsOf = (md: string) => dag.parseNext(md)[0]!.refs;
  const ADR = (n: string): GateRef => ({ kind: 'decision', ref: `ADR-${n}` });
  const P1: GateRef = { kind: 'phase', raw: 'phase-1', folder: null, num: 1 };
  it('一般的 `- 項目`(沒有框)也是 gate 項', () => {
    expect(refsOf('**phase-2** 需要:\n- phase-1 `done`\n- ADR-040\n')).toEqual([P1, ADR('040')]);
  });
  it('框前面可以有縮排:`  - [ ] 項目` 與 `  - [x] 項目` 照收', () => {
    expect(refsOf('**phase-2** 需要:\n  - [ ] ADR-040\n   - [x] ADR-041\n')).toEqual([ADR('040'), ADR('041')]);
  });
  it('一般項目(沒有框)必須在行首:縮排的 `- 項目` 是說明,不收', () => {
    expect(refsOf('**phase-2** 需要:phase-1 `done`\n  - ADR-099 是說明\n')).toEqual([P1]);
    expect(refsOf('**phase-2** 需要:phase-1 `done`\n- ADR-040\n  - ADR-099 子項是說明\n')).toEqual([P1, ADR('040')]);
  });
  it('框後面不要求空白:`- [ ]ADR-040`', () => {
    expect(refsOf('**phase-2** 需要:\n- [ ]ADR-040\n- [x]ADR-041\n')).toEqual([ADR('040'), ADR('041')]);
  });
  it('清單項的框裡只有空白與 x/X:`- [y] ADR-040` 仍是一般項目,文字整段(含 [y])去抽參照', () => {
    expect(refsOf('**phase-2** 需要:\n- [y] ADR-040\n')).toEqual([ADR('040')]);
  });
  it('沒有 `-` 的東西、`-` 不在行首的東西不是項目:遇到就結束', () => {
    expect(refsOf('**phase-2** 需要:\n- ADR-040\nfoo - ADR-099\n- ADR-098\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- ADR-040\nfoo - [ ] ADR-099\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- ADR-040\nx- [ ] ADR-099\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- ADR-040\n-ADR-099\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- ADR-040\n未縮排的文字 ADR-099\n')).toEqual([ADR('040')]);
  });
  it('縮排的續行(不是 `-` 開頭)是這一項的後續:一個或多個空白都行;行中間的 ` - ` 不影響', () => {
    expect(refsOf('**phase-2** 需要:phase-1 `done`、\n  ADR-040 已決定\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:phase-1 `done`、\n ADR-040 單一空白縮排\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:phase-1 `done`、\n  ADR-040 - 行中間的橫線\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- phase-1 `done`\n  ADR-040 續\n    ADR-041 再續\n')).toEqual([P1, ADR('040'), ADR('041')]);
  });
  it('還沒有任何內容時(`需要:` 後面沒東西、也沒有項目),縮排的文字不算續行', () => {
    expect(refsOf('**phase-2** 需要:\n  ADR-040\n')).toEqual([]);
  });
  it('空白行(含只有空白的行)不結束宣告:前後的項目都收', () => {
    expect(refsOf('**phase-2** 需要:\n\n- [ ] phase-1 `done`\n\n- ADR-040\n   \n- ADR-041\n')).toEqual([P1, ADR('040'), ADR('041')]);
  });
  it('遇到 `## ` 標題就結束(縮排的標題也算);`##x`(後面沒空白)與行中間的 `## ` 不是標題', () => {
    expect(refsOf('**phase-2** 需要:\n- phase-1 `done`\n## 其他\n- ADR-099\n')).toEqual([P1]);
    expect(refsOf('**phase-2** 需要:\n- phase-1 `done`\n  ## 縮排的標題\n- ADR-099\n')).toEqual([P1]);
    expect(refsOf('**phase-2** 需要:\n##x 不是標題\n- ADR-040\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\nfoo ## bar\n- ADR-040\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\nabc## bar\n- ADR-040\n')).toEqual([ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- [ ] ADR-040 ## 行內的井字\n')).toEqual([ADR('040')]);
  });
  it('遇到下一個 `**phase-N**` 標頭就結束(兩位數、縮排的也算);行中間的 `**phase-N**` 不是標頭', () => {
    const entries = dag.parseNext('**phase-2** 需要:\n**phase-10**:無 gate\n- ADR-077\n');
    expect(entries.map((e) => [e.phase, e.noGate, e.refs.length])).toEqual([[2, false, 0], [10, true, 0]]);
    const indented = dag.parseNext('**phase-2** 需要:\n  **phase-3**:無 gate\n- ADR-077\n');
    expect(indented.map((e) => [e.phase, e.noGate, e.refs.length])).toEqual([[2, false, 0], [3, true, 0]]);
    expect(refsOf('**phase-2** 需要:phase-1 `done`、\n  續行 **phase-9** 內文 ADR-040\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:\nx**phase-3** 不是標頭\n- ADR-040\n')).toEqual([ADR('040')]);
  });
  it('標頭本身可以縮排;前面有別的字就不是標頭', () => {
    expect(dag.parseNext('  **phase-3** 需要:ADR-040\n')).toEqual([{ phase: 3, noGate: false, refs: [ADR('040')] }]);
    expect(dag.parseNext('x**phase-3** 需要:ADR-040\n')).toEqual([]);
    expect(dag.parseNext('see **phase-3** 需要:ADR-040\n')).toEqual([]);
  });
  it('標頭後面既不是「:無 gate」也不是「需要:」→ 不是宣告,也不崩潰', () => {
    expect(dag.parseNext('**phase-2** 備註一下\n')).toEqual([]);
    expect(dag.parseNext('**phase-2**\n')).toEqual([]);
  });
  it('「:無 gate」:冒號後面的空白可有可無,gate 前面的空白可有可無;不在標頭後面的不算', () => {
    expect(dag.parseNext('**phase-1**: 無 gate\n')).toEqual([{ phase: 1, noGate: true, refs: [] }]);
    expect(dag.parseNext('**phase-1**:無gate\n')).toEqual([{ phase: 1, noGate: true, refs: [] }]);
    expect(dag.parseNext('**phase-1** 說明:無 gate\n')).toEqual([]);
  });
  it('「需要:」:冒號前面的空白可有可無;前面有別的字(不需要:)不算', () => {
    expect(dag.parseNext('**phase-2** 需要 :ADR-040\n')[0]?.refs).toEqual([ADR('040')]);
    expect(dag.parseNext('**phase-2** 不需要:ADR-040\n')).toEqual([]);
  });
  it('各項之間以換行相接,不黏在一起(`ADR-04` 與 `0` 不會變成 `ADR-040`)', () => {
    expect(refsOf('**phase-2** 需要:\n- ADR-04\n- 0\n')).toEqual([ADR('04')]);
  });
  it('單獨的 phase-N 要緊接 done 才算依賴;說明裡提到的 phase-N 不算;有資料夾前綴的照算', () => {
    expect(refsOf('**phase-2** 需要:phase-1 `done`、phase-3 這個說明文字\n')).toEqual([P1]);
    expect(refsOf('**phase-2** 需要:phase-1 done、ADR-040\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:03 phase-3、ADR-040\n')).toEqual([{ kind: 'phase', raw: '03 phase-3', folder: '03', num: 3 }, ADR('040')]);
  });
  it('同一行的內容與清單項、續行合在一起讀', () => {
    expect(refsOf('**phase-2** 需要:phase-1 `done`、\n- ADR-040\n  ADR-041 續\n')).toEqual([P1, ADR('040'), ADR('041')]);
  });
  it('同一個 phase 宣告兩次(一次無 gate、一次需要:無):兩筆都留著,順序照出現', () => {
    expect(dag.parseNext('**phase-2**:無 gate\n\n**phase-2** 需要:無\n').map((e) => e.noGate)).toEqual([true, false]);
  });
});

describe('parseGateRefs:同一個資料夾的兩條寫法(補測)', () => {
  it('`NN phase-A 與 phase-B` 是同一個資料夾的兩條依賴', () => {
    expect(dag.parseGateRefs('01 phase-1 與 phase-2 `done`')).toEqual([
      { kind: 'phase', raw: '01 phase-1', folder: '01', num: 1 },
      { kind: 'phase', raw: '01 phase-2', folder: '01', num: 2 },
    ]);
    expect(dag.parseGateRefs('01-alpha phase-3 與 phase-4')).toEqual([
      { kind: 'phase', raw: '01-alpha phase-3', folder: '01-alpha', num: 3 },
      { kind: 'phase', raw: '01-alpha phase-4', folder: '01-alpha', num: 4 },
    ]);
  });
  it('`NN phase-A/B` 也是同一個資料夾的兩條依賴', () => {
    expect(dag.parseGateRefs('02 phase-2/3 `done`')).toEqual([
      { kind: 'phase', raw: '02 phase-2', folder: '02', num: 2 },
      { kind: 'phase', raw: '02 phase-3', folder: '02', num: 3 },
    ]);
  });
});

describe('compareNatural:補測(輸入順序反過來才看得出方向)', () => {
  const sign = (n: number) => Math.sign(n);
  const both = (a: string, b: string, want: -1 | 1) => {
    expect(sign(dag.compareNatural(a, b)), `${a} vs ${b}`).toBe(want);
    expect(sign(dag.compareNatural(b, a)), `${b} vs ${a}`).toBe(-want);
  };
  it('同樣長度、不同數字:phase-3 在 phase-4 前面(兩個方向)', () => {
    both('phase-3', 'phase-4', -1);
    both('x19', 'x21', -1);
    both('x7', 'x9', -1);
  });
  it('不同長度的數字:短的在前(數值),不管字典序', () => {
    both('phase-9', 'phase-10', -1);
    both('x99', 'x100', -1);
  });
  it('前導零:數值相同時寫法短的/碼位小的在前,而且全序(兩個方向相反)', () => {
    both('x007', 'x7', -1);
    both('phase-02', 'phase-2', -1);
    both('x002', 'x02', -1);
    both('x0', 'x00', -1);
  });
  it('前導零的數字照數值比,不當文字比:010 比 9 大', () => {
    both('x9', 'x010', -1);
    both('x010', 'x11', -1);
  });
  it('文字段按碼位比,不按長度:ab 在 b 前面、a-1 的 -bb 在 -c 前面(兩個方向)', () => {
    both('ab', 'b', -1);
    both('a1-bb', 'a1-c', -1);
    both('abc', 'abd', -1);
    both('B', 'a', -1);
  });
  it('文字段比到分出高下為止:數字前面的字不同,後面的數字不看', () => {
    both('a9', 'b1', -1);
    both('aa1', 'ab0', -1);
  });
  it('數字段對文字段:數字在前,不管長度(10 在 a 前面)', () => {
    both('10', 'a', -1);
    both('1a', 'a1', -1);
    both('99x', 'x', -1);
  });
  it('一段是另一段的前綴(段落個數不同):短的在前,不會因為讀到第 n+1 段而崩潰', () => {
    both('a1', 'a1b', -1);
    both('x', 'x1', -1);
    both('a1b2', 'a1b2c', -1);
    both('phase-2', 'phase-2-b', -1);
  });
  it('排一串(輸入順序是反的):phase-2、phase-3、phase-4、phase-10、phase-11', () => {
    const shuffled = ['phase-11', 'phase-4', 'phase-10', 'phase-2', 'phase-3'];
    expect([...shuffled].sort(dag.compareNatural)).toEqual(['phase-2', 'phase-3', 'phase-4', 'phase-10', 'phase-11']);
    expect([...shuffled].reverse().sort(dag.compareNatural)).toEqual(['phase-2', 'phase-3', 'phase-4', 'phase-10', 'phase-11']);
  });
  it('每一組都滿足全序:反對稱,而且排好之後相鄰兩個的比較是小於', () => {
    const pool = ['', 'a', 'b', 'a1', 'a01', 'a1b', 'a10', 'a2', '1', '01', '10', 'x007', 'x7', 'ab', 'abc', 'B', '-', 'phase-1', 'phase-10', 'phase-2'];
    for (const x of pool) for (const y of pool) expect(sign(dag.compareNatural(x, y)) + sign(dag.compareNatural(y, x)), `${x} / ${y}`).toBe(0);
    const sorted = [...pool].sort(dag.compareNatural);
    for (let i = 1; i < sorted.length; i += 1) expect(dag.compareNatural(sorted[i - 1]!, sorted[i]!)).toBeLessThan(0);
  });
});

describe('parsePhaseTable:補測', () => {
  it('表的每一列前後可以有空白(縮排的表也讀得到)', () => {
    const md = '  | Phase | 標題 | 階段 | 狀態 | 完成日 |  \n  |---|---|---|---|---|  \n  | 1 | t | Wave 0 | done | |  \n  | 2 | t | Wave 0 | todo | |  \n';
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'todo' }]);
  });
  it('第一個不是表列的行(不以 | 開頭)就結束這張表:後面的列不算,就算長得像列', () => {
    const md = `${HEAD}| 1 | t | Wave 0 | done | |\n說明文字\n| 2 | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }]);
    const stray = `${HEAD}| 1 | t | Wave 0 | done | |\nnote | 9 | t | Wave | done | |\n`;
    expect(dag.parsePhaseTable(stray)).toEqual([{ phase: 1, status: 'done' }]);
  });
  it('表在檔尾、最後一行後面沒有換行也讀得到(不會讀過檔尾)', () => {
    const md = `${HEAD}| 1 | t | Wave 0 | done | |\n| 2 | t | Wave 0 | ready | |`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'ready' }]);
  });
  it('「狀態」可以在第一欄(欄的位置用表頭找,第 0 欄也行)', () => {
    expect(dag.parsePhaseTable('| 狀態 | Phase |\n|---|---|\n| done | 1 |\n| todo | 2 |\n')).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'todo' }]);
  });
  it('有「狀態」但沒有「Phase」的表不算;後面真正的 Phase 表照讀', () => {
    const md = `| 標題 | 狀態 |\n|---|---|\n| 甲 | done |\n\n${HEAD}| 4 | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 4, status: 'todo' }]);
  });
  it('有「Phase」但沒有「狀態」的表不算;後面真正的 Phase 表照讀', () => {
    const md = `| Phase | 需要 |\n|---|---|\n| 1 | x |\n\n${HEAD}| 5 | t | Wave 0 | done | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 5, status: 'done' }]);
  });
  it('第一格不是整個數字的列略過:2b、a2、phase 3、空白、小數', () => {
    const md = `${HEAD}| 2b | t | Wave 0 | todo | |\n| a2 | t | Wave 0 | todo | |\n| phase 3 | t | Wave 0 | todo | |\n|  | t | Wave 0 | todo | |\n| 1.5 | t | Wave 0 | todo | |\n| 7 | t | Wave 0 | done | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 7, status: 'done' }]);
  });
  it('分隔列的各種寫法(冒號對齊、多個減號)都不是資料列', () => {
    const md = '| Phase | 狀態 |\n|:---|---:|\n| 1 | done |\n|:-:|:-:|\n| 2 | todo |\n';
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'todo' }]);
  });
  it('CRLF 換行也讀得到', () => {
    expect(dag.parsePhaseTable('| Phase | 狀態 |\r\n|---|---|\r\n| 1 | done |\r\n| 2 | todo |\r\n')).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'todo' }]);
  });
  it('狀態只取開頭的關鍵字:後面接字母或減號的不算(todox、done-ish),接標點空白的算', () => {
    const rows = dag.parsePhaseTable(featureMd([[1, 'todox'], [2, 'done-ish'], [3, 'ready(等 I4)'], [4, 'in-progress 做了一半'], [5, 'blocked,等人']]));
    expect(rows.map((r) => r.status)).toEqual(['todox', 'done-ish', 'ready', 'in-progress', 'blocked']);
  });
  it('狀態格是空的:status 是空字串,不崩潰', () => {
    expect(dag.parsePhaseTable(featureMd([[1, '']]))).toEqual([{ phase: 1, status: '' }]);
  });
  it('第一張符合的表就是 Phase 表:後面另一張也有 Phase 與狀態的表不讀', () => {
    const md = `${HEAD}| 1 | t | Wave 0 | done | |\n\n${HEAD}| 2 | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(md)).toEqual([{ phase: 1, status: 'done' }]);
  });
});

describe('analyzeTree:補測', () => {
  it('同一個 phase 在表裡出現兩列:第一列算', () => {
    const a = run({ [A]: { rows: [[1, 'done'], [2, 'todo'], [2, 'done']], next: NO_GATE(1) + NEEDS(2, 'phase-1 `done`') } });
    expect(a.lines).toEqual([`READY ${A}/phase-2 (table says todo)`]);
  });
  it('同一個 phase 宣告兩次:任一次有 gate 就算有 gate(READY 加表上狀態註記)', () => {
    const a = run({ [A]: { rows: [[2, 'todo']], next: '**phase-2**:無 gate\n\n**phase-2** 需要:無\n' } });
    expect(a.lines).toEqual([`READY ${A}/phase-2 (table says todo)`]);
  });
  it('資料夾前綴(NN)對到不只一個資料夾:解不開 → unresolved-ref;對到剛好一個才算', () => {
    const a = run({
      '01-a': { rows: [[1, 'done']], next: NO_GATE(1) },
      '01-b': { rows: [[1, 'done']], next: NO_GATE(1) },
      '02-c': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    expect(a.lines).toContain('PROBLEM unresolved-ref 02-c/phase-1 01 phase-1');
    expect(ofKind(a, 'READY')).toEqual([]);
  });
  it('資料夾全名寫得出來就用全名(就算前綴不只一個資料夾也解得開)', () => {
    const a = run({
      '01-a': { rows: [[1, 'done']], next: NO_GATE(1) },
      '01-b': { rows: [[1, 'done']], next: NO_GATE(1) },
      '02-c': { rows: [[1, 'todo']], next: NEEDS(1, '01-a/phase-1 `done`') },
    });
    expect(a.lines).toEqual(['READY 02-c/phase-1 (table says todo)']);
  });
  it('同一個解不開的參照寫兩次:只報一行', () => {
    const a = run({ [A]: { rows: [[1, 'todo']], next: NEEDS(1, '09 phase-7 `done`、09 phase-7 `done`') } });
    expect(ofKind(a, 'PROBLEM')).toEqual([`PROBLEM unresolved-ref ${A}/phase-1 09 phase-7`]);
  });
  it('done 或 in-progress 的 phase 有決策 gate:不出 HUMAN(不列)', () => {
    for (const status of ['done', 'in-progress']) {
      const a = run({ [A]: { rows: [[1, status]], next: NEEDS(1, 'ADR-040 已決定') } });
      expect(a.lines, status).toEqual([]);
      expect(a.counts.human, status).toBe(0);
    }
  });
  it('不認得的狀態(wip)不列:沒有 READY、BLOCKED、HUMAN,也不報 gate-not-declared', () => {
    const a = run({ [A]: { rows: [[1, 'wip'], [2, 'wip']], next: NO_GATE(1) } });
    expect(a.lines).toEqual([]);
  });
  it('環上有已完成的節點:環上的 todo 節點仍然不是 READY(就算它需要的都 done)', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
      '02-b': { rows: [[1, 'done']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    expect(ofKind(a, 'READY')).toEqual([]);
    expect(ofKind(a, 'PROBLEM')).toEqual(['PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 01-a/phase-1']);
  });
  it('兩個環共用節點:每個環各一行,走回頭路時路徑要還原(A→B→D→A 與 A→C→D→A)', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`、03 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '04 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '04 phase-1 `done`') },
      '04-d': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual([
      'PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 04-d/phase-1 -> 01-a/phase-1',
      'PROBLEM cycle 01-a/phase-1 -> 03-c/phase-1 -> 04-d/phase-1 -> 01-a/phase-1',
    ]);
  });
  it('環裡沒有節點被重複走:A↔B 與 B↔C 兩個環各報一次', () => {
    const a = run({
      '01-a': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
      '02-b': { rows: [[1, 'todo']], next: NEEDS(1, '01 phase-1 `done`、03 phase-1 `done`') },
      '03-c': { rows: [[1, 'todo']], next: NEEDS(1, '02 phase-1 `done`') },
    });
    expect(ofKind(a, 'PROBLEM')).toEqual([
      'PROBLEM cycle 01-a/phase-1 -> 02-b/phase-1 -> 01-a/phase-1',
      'PROBLEM cycle 02-b/phase-1 -> 03-c/phase-1 -> 02-b/phase-1',
    ]);
  });
  it('只依賴「沒有自己宣告」的 phase(葉子)也不會報環', () => {
    const a = run({ [A]: { rows: [[1, 'todo'], [2, 'todo']], next: NEEDS(2, 'phase-1 `done`') } });
    expect(a.lines.filter((l) => l.includes('cycle'))).toEqual([]);
  });
});

describe('scripts/dag.ts 當指令跑:補測', () => {
  const stderrOf = (args: string[]) => runDag(args).stderr;
  it('用法錯誤的 stderr 只有那一行 Usage(不接別的訊息)', () => {
    expect(stderrOf([])).toBe('Usage: npx tsx scripts/dag.ts --root <tree>\n');
    expect(stderrOf(['--bogus', copyFixture('dag-usage-a')])).toBe('Usage: npx tsx scripts/dag.ts --root <tree>\n');
  });
  it('參數個數與旗標名字都要對:--root 之外的旗標(帶值)、--root 帶空字串、多餘的參數 → 用法錯誤 2', () => {
    const tree = copyFixture('dag-args');
    for (const args of [['--bogus', tree], ['--root', ''], ['--root', tree, '--extra'], [tree, '--root'], ['--roots', tree]]) {
      const r = runDag(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr, args.join(' ')).toBe('Usage: npx tsx scripts/dag.ts --root <tree>\n');
      expect(r.stdout, args.join(' ')).toBe('');
    }
  }, 120_000);
  it('錯誤訊息逐字:不存在的根、根是檔案、沒有 features 目錄', () => {
    const file = join(mkTmp('dag-notdir'), 'a-file.txt');
    writeFileSync(file, 'x');
    expect(runDag(['--root', '/nonexistent-dag-root-xyz']).stderr).toBe('root not found: /nonexistent-dag-root-xyz\n');
    expect(runDag(['--root', file]).stderr).toBe(`root is not a directory: ${file}\n`);
    const empty = mkTmp('dag-nofeat');
    expect(runDag(['--root', empty]).stderr).toBe(`no features directory: ${join(empty, 'features')}\n`);
    for (const args of [['--root', file], ['--root', empty], ['--root', '/nonexistent-dag-root-xyz']]) expect(runDag(args).status, args.join(' ')).toBe(2);
  }, 120_000);
  it('features 是檔案不是目錄:no features directory', () => {
    const root = mkTmp('dag-featfile');
    writeFileSync(join(root, 'features'), 'not a directory');
    const r = runDag(['--root', root]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(`no features directory: ${join(root, 'features')}\n`);
  });
  it('FEATURE.md 或 NEXT.md 是目錄:not a file,退出碼 2', () => {
    for (const name of ['FEATURE.md', 'NEXT.md']) {
      const root = mkTmp('dag-notfile');
      mkdirSync(join(root, 'features/05-x', name), { recursive: true });
      const r = runDag(['--root', root]);
      expect(r.status, name).toBe(2);
      expect(r.stderr, name).toBe(`not a file: ${join(root, 'features/05-x', name)}\n`);
    }
  });
  it('features 底下只有 NN- 開頭的資料夾算功能:別的名字、檔案、前面多一個字的都略過,不報 PROBLEM', () => {
    const root = mkTmp('dag-names');
    writeTree(root, { [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } });
    for (const dir of ['steps', 'support', '_template', 'a01-x', '1-x', 'x-01-y']) mkdirSync(join(root, 'features', dir), { recursive: true });
    writeFileSync(join(root, 'features/07-notes.md'), '# 這是檔案,名字像功能資料夾');
    writeFileSync(join(root, 'features/README.md'), '# features');
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('PROBLEM'))).toEqual([]);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=0 human=0 problems=0');
  }, 60_000);
  it('壞掉的符號連結(名字像功能資料夾)略過,不崩潰', () => {
    const root = mkTmp('dag-dangling');
    writeTree(root, { [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } });
    symlinkSync('/nonexistent-dag-target', join(root, 'features/06-dangling'));
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=0 human=0 problems=0');
  }, 60_000);
  it('讀不了 features 目錄(沒有權限):不是用法錯誤,印 dag failed 並退出碼 2', () => {
    const root = mkTmp('dag-eacces');
    writeTree(root, { [A]: { rows: [[1, 'todo']], next: NO_GATE(1) } });
    chmodSync(join(root, 'features'), 0o000);
    try {
      if (process.getuid?.() === 0) return; // root 讀得了任何目錄,這條沒有意義
      const r = runDag(['--root', root]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^dag failed: /);
      expect(r.stdout).toBe('');
    } finally {
      chmodSync(join(root, 'features'), 0o755);
    }
  }, 60_000);
  it('資料夾裡沒有 NEXT.md:todo 的 phase 報 gate-not-declared,不崩潰', () => {
    const root = mkTmp('dag-nonext');
    writeTree(root, { [A]: { rows: [[1, 'todo']] } });
    const r = runDag(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain(`PROBLEM gate-not-declared ${A}/phase-1`);
  }, 60_000);
  it('git tag 的輸出每行去頭尾空白、略過空行:tag 名字對得上才解鎖,空 tag 清單照跑', () => {
    const spec: Record<string, Spec> = { [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, 'phase-1 `done`、**I4 通過**') } };
    const noTags = mkTmp('dag-notags');
    writeTree(noTags, spec);
    gitInit(noTags, []);
    const r = runDag(['--root', noTags]);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toContain(`BLOCKED ${A}/phase-2 by I4`);
    const some = mkTmp('dag-sometags');
    writeTree(some, spec);
    gitInit(some, ['v1', 'I4', 'I5']);
    expect(runDag(['--root', some]).stdout.split('\n')).toContain(`READY ${A}/phase-2 (table says todo)`);
  }, 60_000);
  it('tag 在根的上層 repo 裡(根是 repo 的子資料夾):讀的是那個 repo 的 tag', () => {
    const repo = mkTmp('dag-subroot');
    gitInit(repo, ['I4']);
    const sub = join(repo, 'sub');
    mkdirSync(sub);
    writeTree(sub, { [A]: { rows: [[1, 'done'], [2, 'todo']], next: NEEDS(2, 'phase-1 `done`、**I4 通過**') } });
    expect(runDag(['--root', sub]).stdout.split('\n')).toContain(`READY ${A}/phase-2 (table says todo)`);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════ 靜態:原始碼與登記
describe('scripts/dag.ts 的原始碼與登記', () => {
  const source = (): string => readFileSync(DAG_TS, 'utf8');
  /** 檔頭註解 = 第一行程式碼(import / export / const / function …)之前的所有東西 */
  const header = (): string => {
    const lines = source().split('\n');
    const at = lines.findIndex((l) => /^\s*(import|export|const|let|var|function|async|type|interface|class)\b/.test(l));
    return lines.slice(0, at === -1 ? lines.length : at).join('\n');
  };
  const code = (): string => source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('檔頭註解列出每一種 PROBLEM 種類', () => {
    for (const kind of ['cycle', 'unresolved-ref', 'no-phase-table', 'gate-not-declared']) {
      expect(header(), `檔頭註解少了 ${kind}`).toContain(kind);
    }
    expect(header()).toContain('PROBLEM');
  });

  it('只 import node: 內建模組:不 import 別的腳本(含 check-next-gates)、不引入 YAML / markdown 套件', () => {
    const src = code();
    const specs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    const bare = [...src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    const dynamic = [...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
    const requires = [...src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
    for (const s of [...specs, ...bare, ...dynamic, ...requires]) expect(s, `import ${s}`).toMatch(/^node:/);
  });

  it('不寫檔:原始碼裡沒有 fs 的寫入 API', () => {
    const banned = /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdtempSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|symlinkSync|openSync)\b/;
    expect(code()).not.toMatch(banned);
  });

  it('登記:owners 表有 scripts/dag.ts 與 scripts/dag.test.ts → 13-work-dag', () => {
    const owners = (JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/boundaries.owners.json'), 'utf8')) as { owners: [string, string][] }).owners;
    const landing = (file: string) => owners.filter(([prefix]) => file === prefix).map(([, o]) => o);
    expect(landing('scripts/dag.ts')).toEqual(['13-work-dag']);
    expect(landing('scripts/dag.test.ts')).toEqual(['13-work-dag']);
  });

  it('登記:零輸入名冊提到 scripts/dag.ts', () => {
    expect(readFileSync(join(REPO_ROOT, 'scripts/zero-input-roster.ts'), 'utf8')).toMatch(/['"]scripts\/dag\.ts['"]/);
  });

  it('登記:standalone.json 有 13-work-dag,指令跑 scripts/dag.ts 對 fixture basic,expect 是 gate=dag', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'standalone.json'), 'utf8')) as Record<string, { cmd: string; interactive: boolean; expect?: string }>;
    const entry = manifest['13-work-dag'];
    expect(entry, 'standalone.json 沒有 13-work-dag').toBeDefined();
    expect(entry!.cmd).toContain('scripts/dag.ts');
    expect(entry!.cmd).toContain('features/13-work-dag/fixtures/basic');
    expect(entry!.interactive).toBe(false);
    expect(entry!.expect).toBe('gate=dag');
  });

  it('phase-1.feature 的檔頭 tag 行有 @standalone(場景沒動,只動 tag 行)', () => {
    const first = readFileSync(join(REPO_ROOT, 'features/13-work-dag/phase-1.feature'), 'utf8').split('\n')[0]!;
    expect(first.split(/\s+/)).toEqual(expect.arrayContaining(['@wave0', '@work-dag', '@phase-1', '@standalone']));
  });

  it('fixture basic 還在(測試資料不是 stub)', () => {
    expect(existsSync(join(FIXTURE_BASIC, 'features/01-alpha/NEXT.md'))).toBe(true);
  });
});
