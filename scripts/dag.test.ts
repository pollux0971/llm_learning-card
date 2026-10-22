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
import * as P2 from '../features/support/dag-p2-harness.js';

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
      [['--checks', '--root', copyFixture('dag-check')], 'Usage:'],
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
    for (const line of ['普通文字', '-沒空白', 'a - b', 'x- y', 'a - [ ] b', 'x- [x] y', 'foo - [ ] 項目', '* 項目', '+ 項目', '-- 項目', '', '[ ] 沒有橫線', '-[ ] 框前沒空白', '  普通縮排文字']) {
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
  it('打了框的項目後面的縮排續行也收(續行不只跟在一般項目後面)', () => {
    expect(refsOf('**phase-2** 需要:\n- [ ] phase-1 `done`\n  ADR-040 續\n')).toEqual([P1, ADR('040')]);
    expect(refsOf('**phase-2** 需要:\n- [x] phase-1 `done`\n  ADR-040 續\n    ADR-041 再續\n')).toEqual([P1, ADR('040'), ADR('041')]);
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
  it('前導零之後長度相同的數字:數值小的在前,就算寫法(文字)的順序相反', () => {
    both('x3', 'x04', -1);
    both('x03', 'x4', -1);
    both('x04', 'x13', -1);
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
  it('只有一個 | 的行結束這張表;一格的列(| 說明 |)不結束,只是略過', () => {
    const lone = `${HEAD}| 1 | t | Wave 0 | done | |\n|\n| 2 | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(lone)).toEqual([{ phase: 1, status: 'done' }]);
    const note = `${HEAD}| 1 | t | Wave 0 | done | |\n| 說明 |\n| 2 | t | Wave 0 | todo | |\n`;
    expect(dag.parsePhaseTable(note)).toEqual([{ phase: 1, status: 'done' }, { phase: 2, status: 'todo' }]);
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// phase-2(工單 T39):工單進圖、R1–R5、LANDING / START / HELD / WARN、--orca、--check。
// 只認 CLI(`--root`、`--check`、`--orca`),不綁 scripts/dag.ts 的匯出名(實作者可以把 dag:check 拆成 dag-check.ts)。
// 假樹與工單檔由 features/support/dag-p2-harness.ts 蓋;規格:features/13-work-dag/FEATURE.md、phase-2.feature。
// 對照 must_catch 的表在交件說明;每個 describe 開頭標了它守的 must_catch。
// ═══════════════════════════════════════════════════════════════════════════════════════
type Row = P2.TicketRow;
const LANDING = P2.FEATURE_LANDING;

/** 蓋一棵只有工單的假樹(預設落點表同 phase-2.feature 的 Background) */
function p2Tree(tickets: Row[], opts: { landing?: [string, string][] | null; features?: { folder: string; rows: [number, string][]; next: string }[] } = {}): string {
  const root = mkTmp('dag-p2');
  if (opts.landing !== null) P2.writeLanding(root, opts.landing ?? LANDING);
  for (const t of tickets) P2.writeTicket(root, t);
  for (const f of opts.features ?? []) P2.writeFeature(root, f.folder, f.rows, f.next);
  mkdirSync(join(root, 'features'), { recursive: true });
  return root;
}
const report = (root: string, ...flags: string[]) => P2.runDagCli(['--root', root, ...flags]);
const checkOf = (root: string) => report(root, '--check');
const hasLine = (r: { stdout: string }, line: string): boolean => r.stdout.split('\n').includes(line);
const linesStarting = (r: { stdout: string }, prefix: string): string[] => P2.startsWith(r.stdout, prefix);
const T = (id: string, status: string, touches: string, extra: Partial<Row> = {}): Row => ({ id, status, touches, ...extra });

describe('phase-2:R2 最長前綴(must_catch:最長前綴改成第一個符合的前綴 → 紅)', () => {
  it('落點表裡短前綴排在長前綴前面也要選最長的:LANDING 印 04-scheduler,不是 core;兩張因此不相交', () => {
    const root = p2Tree([T('T1', 'dispatched', 'packages/core/src/scheduler/due.ts'), T('T2', 'dispatched', 'packages/core/src/ingest/')]);
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'LANDING T1 04-scheduler')).toBe(true);
    expect(hasLine(r, 'LANDING T2 core')).toBe(true);
  }, 60_000);

  it('落點表順序反過來(長前綴在前)結果一樣:順序不是比對規則', () => {
    const root = p2Tree([T('T1', 'dispatched', 'packages/core/src/scheduler/due.ts')], { landing: [...LANDING].reverse() });
    const r = checkOf(root);
    expect(hasLine(r, 'LANDING T1 04-scheduler'), r.stdout).toBe(true);
  }, 60_000);

  it('三層前綴(a/ → x、a/b/ → y、a/b/c/ → z):touches a/b/c/d.ts 是 z,a/b/d.ts 是 y,a/d.ts 是 x', () => {
    const landing: [string, string][] = [['a/b/c/', 'z'], ['a/', 'x'], ['a/b/', 'y']];
    const root = p2Tree([T('T1', 'todo', 'a/b/c/d.ts'), T('T2', 'todo', 'a/b/d.ts'), T('T3', 'todo', 'a/d.ts')], { landing });
    const r = report(root);
    expect(hasLine(r, 'LANDING T1 z')).toBe(true);
    expect(hasLine(r, 'LANDING T2 y')).toBe(true);
    expect(hasLine(r, 'LANDING T3 x')).toBe(true);
  }, 60_000);

  it('目錄涵蓋底下所有表列:touches scripts/(表裡只有 scripts/due.ts 這種更長的列)對得到 04-scheduler,不是 no-landing', () => {
    const root = p2Tree([T('T1', 'todo', 'scripts/')], { landing: [['scripts/due.ts', '04-scheduler']] });
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'LANDING T1 04-scheduler')).toBe(true);
    expect(linesStarting(r, 'PROBLEM no-landing')).toEqual([]);
  }, 60_000);

  it('只有以 / 結尾的才算目錄:touches scripts/d(不是目錄)不涵蓋 scripts/due.ts → no-landing', () => {
    const root = p2Tree([T('T1', 'todo', 'scripts/d')], { landing: [['scripts/due.ts', '04-scheduler']] });
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM no-landing T1 scripts/d')).toBe(true);
  }, 60_000);
});

describe('phase-2:LANDING 只印還沒結束的工單', () => {
  it('merged / dropped 沒有 LANDING 行;todo / dispatched / review 各一行', () => {
    const root = p2Tree([T('T1', 'merged', 'docs/a/'), T('T2', 'dropped', 'docs/b/'), T('T3', 'todo', 'docs/c/'), T('T4', 'dispatched', 'scripts/x.ts'), T('T5', 'review', 'apps/desktop/')]);
    const r = report(root);
    expect(linesStarting(r, 'LANDING ')).toEqual(['LANDING T3 docs', 'LANDING T4 infra', 'LANDING T5 10-desktop-shell']);
  }, 60_000);
});

describe('phase-2:no-landing 只查還沒結束的工單(must_catch:merged/dropped 對不到落點不出 PROBLEM、不紅;todo/dispatched/review 仍紅;解讀 8)', () => {
  for (const status of ['merged', 'dropped']) {
    it(`${status} 的工單 touches 對不到落點:沒有 PROBLEM no-landing、--check 退出碼 0、也沒有 LANDING 行`, () => {
      const root = p2Tree([T('T1', status, 'old/removed/dir/')]);
      const r = checkOf(root);
      expect(r.status, r.stdout).toBe(0);
      expect(linesStarting(r, 'PROBLEM')).toEqual([]);
      expect(linesStarting(r, 'LANDING T1')).toEqual([]);
      expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/problems=0$/);
    }, 60_000);
  }

  for (const status of ['todo', 'dispatched', 'review']) {
    it(`${status} 的工單 touches 對不到落點:PROBLEM no-landing T1 <前綴>,--check 退出碼 1`, () => {
      const root = p2Tree([T('T1', status, 'old/removed/dir/')]);
      const r = checkOf(root);
      expect(r.status).toBe(1);
      expect(hasLine(r, 'PROBLEM no-landing T1 old/removed/dir/')).toBe(true);
    }, 60_000);
  }

  it('一張工單兩個項目都對不到:各印一行;對得到的那個不印', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/, nowhere/one/, nowhere/two.ts')]);
    const r = checkOf(root);
    expect(linesStarting(r, 'PROBLEM no-landing')).toEqual(['PROBLEM no-landing T1 nowhere/one/', 'PROBLEM no-landing T1 nowhere/two.ts']);
  }, 60_000);

  it('不替沒登記的檔猜落點:落點表是空的,所有 touches 都是 no-landing', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/')], { landing: [] });
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM no-landing T1 docs/a/')).toBe(true);
  }, 60_000);
});

describe('phase-2:R2 落點重疊(must_catch:review 佔落點;contracts 互斥;infra 用檔案層級比對)', () => {
  const exitOf = (a: Row, b: Row, landing?: [string, string][]): number | null => {
    const r = checkOf(p2Tree([a, b], landing ? { landing } : {}));
    return r.status;
  };

  it('狀態矩陣(兩張落在同一個非 infra 落點):只有「至少一張 dispatched、另一張 dispatched 或 review」才紅', () => {
    const cases: [string, string, number][] = [
      ['dispatched', 'dispatched', 1],
      ['review', 'dispatched', 1],
      ['dispatched', 'review', 1],
      ['review', 'review', 0],
      ['todo', 'dispatched', 0],
      ['dispatched', 'todo', 0],
      ['todo', 'review', 0],
      ['merged', 'dispatched', 0],
      ['dropped', 'dispatched', 0],
      ['dispatched', 'merged', 0],
    ];
    for (const [a, b, want] of cases) {
      expect(exitOf(T('T1', a, 'apps/desktop/src-tauri/'), T('T2', b, 'apps/desktop/src/')), `${a} + ${b}`).toBe(want);
    }
  }, 180_000);

  it('PROBLEM 行的形狀:r2-overlap <小 id> <大 id> on <落點>;T2 排在 T10 前面(自然排序)', () => {
    const r = checkOf(p2Tree([T('T10', 'dispatched', 'apps/desktop/a/'), T('T2', 'dispatched', 'apps/desktop/b/')]));
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM r2-overlap T2 T10 on 10-desktop-shell')).toBe(true);
  }, 60_000);

  it('contracts 和任何工作互斥:contracts + infra 的檔、contracts + docs、contracts + contracts 都是重疊,落點名是 contracts', () => {
    for (const other of ['scripts/dag.ts', 'docs/b/', 'contracts/types.md']) {
      const r = checkOf(p2Tree([T('T1', 'dispatched', 'contracts/'), T('T2', 'dispatched', other)]));
      expect(r.status, other).toBe(1);
      expect(hasLine(r, 'PROBLEM r2-overlap T1 T2 on contracts'), `${other}\n${r.stdout}`).toBe(true);
    }
  }, 180_000);

  it('contracts 的工單是 todo 時不佔位:別人 dispatched 照樣綠;contracts 工單 dispatched、另一張只是 todo 也綠(還沒在跑)', () => {
    expect(exitOf(T('T1', 'todo', 'contracts/'), T('T2', 'dispatched', 'docs/b/'))).toBe(0);
    expect(exitOf(T('T1', 'dispatched', 'contracts/'), T('T2', 'todo', 'docs/b/'))).toBe(0);
  }, 120_000);

  it('infra 用檔案層級比對:逐字相同 / 目錄前綴才重疊;同目錄不同檔、兄弟目錄、「是前綴但不是目錄」都不重疊', () => {
    const cases: [string, string, number][] = [
      ['scripts/a.ts', 'scripts/a.ts', 1],
      ['scripts/', 'scripts/a.ts', 1],
      ['scripts/a.ts', 'scripts/', 1],
      ['scripts/sub/', 'scripts/sub/deep/x.ts', 1],
      ['scripts/a.ts', 'scripts/b.ts', 0],
      ['scripts/sub1/', 'scripts/sub2/', 0],
      ['scripts/a', 'scripts/a.ts', 0], // scripts/a 不是目錄(沒有結尾斜線),只是字串前綴
      ['scripts/sub/', 'scripts/subway.ts', 0], // sub/ 不是 subway.ts 的目錄前綴
    ];
    for (const [first, second, want] of cases) {
      expect(exitOf(T('T1', 'dispatched', first), T('T2', 'dispatched', second)), `${first} + ${second}`).toBe(want);
    }
  }, 300_000);

  it('infra 的 r2-overlap 落點寫 infra:<重疊的那個項目,目錄前綴取較短的那個>', () => {
    const r = checkOf(p2Tree([T('T1', 'dispatched', 'scripts/sub/deep/'), T('T2', 'dispatched', 'scripts/sub/')]));
    expect(hasLine(r, 'PROBLEM r2-overlap T1 T2 on infra:scripts/sub/'), r.stdout).toBe(true);
  }, 60_000);

  it('一張工單有兩個項目(一個非 infra、一個 infra):非 infra 部分用落點比對、infra 部分用檔案比對,各自獨立判斷', () => {
    // docs/ 落點相同 → 重疊(即使 infra 的檔不同)
    const a = checkOf(p2Tree([T('T1', 'dispatched', 'docs/a/, scripts/x.ts'), T('T2', 'dispatched', 'docs/b/, scripts/y.ts')]));
    expect(a.status, a.stdout).toBe(1);
    expect(hasLine(a, 'PROBLEM r2-overlap T1 T2 on docs')).toBe(true);
    // docs 不同、infra 的檔不同 → 不重疊
    const b = checkOf(p2Tree([T('T1', 'dispatched', 'docs/a/, scripts/x.ts'), T('T2', 'dispatched', 'apps/desktop/, scripts/y.ts')]));
    expect(b.status, b.stdout).toBe(0);
  }, 120_000);

  it('進行中的 phase 沒有 touches,不參與 R2:ready 的 phase 和 dispatched 工單同時存在,不出 r2-overlap', () => {
    const root = p2Tree([T('T1', 'dispatched', 'features/')], {
      landing: [...LANDING, ['features/', 'steps']],
      features: [{ folder: '01-alpha', rows: [[1, 'in-progress']], next: '**phase-1**:無 gate。' }],
    });
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
  }, 60_000);
});

describe('phase-2:R3 重活(must_catch:R3 改成只數 dispatched → review 場景紅)', () => {
  const heavy = (a: string, b: string): { status: number | null; stdout: string } => checkOf(p2Tree([T('T1', a, 'docs/a/', { cpu: 'heavy' }), T('T2', b, 'scripts/x.ts', { cpu: 'heavy' })]));

  it('狀態矩陣:dispatched 或 review 的 heavy 合計超過 1 張才紅;todo / merged / dropped 不算', () => {
    const cases: [string, string, number][] = [
      ['dispatched', 'dispatched', 1],
      ['dispatched', 'review', 1],
      ['review', 'dispatched', 1],
      ['review', 'review', 1],
      ['review', 'todo', 0],
      ['dispatched', 'merged', 0],
      ['dispatched', 'dropped', 0],
      ['todo', 'todo', 0],
    ];
    for (const [a, b, want] of cases) expect(heavy(a, b).status, `${a} + ${b}`).toBe(want);
  }, 300_000);

  it('PROBLEM r3-heavy <id> <id>(自然排序)', () => {
    const r = checkOf(p2Tree([T('T10', 'review', 'docs/a/', { cpu: 'heavy' }), T('T2', 'dispatched', 'scripts/x.ts', { cpu: 'heavy' })]));
    expect(hasLine(r, 'PROBLEM r3-heavy T2 T10'), r.stdout).toBe(true);
  }, 60_000);

  it('light 的工單不受 R3 管:heavy 在 review、light 在 dispatched → 綠', () => {
    const r = checkOf(p2Tree([T('T1', 'review', 'docs/a/', { cpu: 'heavy' }), T('T2', 'dispatched', 'scripts/x.ts', { cpu: 'light' })]));
    expect(r.status, r.stdout).toBe(0);
  }, 60_000);

  it('ready 的 heavy 被 review 的 heavy 擋住:HELD T2 by R3 with T1;被兩張擋住時 with 列兩個(自然排序)', () => {
    const r = report(p2Tree([T('T1', 'review', 'docs/a/', { cpu: 'heavy' }), T('T2', 'todo', 'scripts/x.ts', { cpu: 'heavy' })]));
    expect(hasLine(r, 'HELD T2 by R3 with T1')).toBe(true);
    const two = report(p2Tree([T('T10', 'dispatched', 'docs/a/', { cpu: 'heavy' }), T('T2', 'review', 'apps/desktop/', { cpu: 'heavy' }), T('T3', 'todo', 'scripts/x.ts', { cpu: 'heavy' })]));
    expect(hasLine(two, 'HELD T3 by R3 with T2,T10'), two.stdout).toBe(true);
  }, 120_000);
});

describe('phase-2:START / HELD(must_catch:自然排序;一個 ticket 每違反一條規則印一行,順序 R2、R3、R4)', () => {
  it('互相衝突的兩張 ready:id 較小的 START、另一張 HELD by R2 with 它;T2 排在 T10 前面', () => {
    const r = report(p2Tree([T('T10', 'todo', 'docs/a/'), T('T2', 'todo', 'docs/b/')]));
    expect(hasLine(r, 'START T2')).toBe(true);
    expect(hasLine(r, 'HELD T10 by R2 with T2')).toBe(true);
    expect(linesStarting(r, 'START T10')).toEqual([]);
  }, 60_000);

  it('契約落點的 ready 工單單獨跑:先選到的 docs 工單 START,contracts 的被擋;反過來 contracts 先選,docs 被擋', () => {
    const a = report(p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'contracts/')]));
    expect(hasLine(a, 'START T1')).toBe(true);
    expect(hasLine(a, 'HELD T2 by R2 with T1')).toBe(true);
    const b = report(p2Tree([T('T1', 'todo', 'contracts/'), T('T2', 'todo', 'docs/a/')]));
    expect(hasLine(b, 'START T1')).toBe(true);
    expect(hasLine(b, 'HELD T2 by R2 with T1')).toBe(true);
  }, 120_000);

  it('在跑的工單(dispatched / review)擋 ready 的:with 列出擋它的在跑工單(自然排序),不列沒擋它的', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'apps/desktop/a/'), T('T2', 'review', 'apps/desktop/b/'), T('T3', 'dispatched', 'docs/z/'), T('T4', 'todo', 'apps/desktop/c/')]));
    expect(hasLine(r, 'HELD T4 by R2 with T1,T2'), r.stdout).toBe(true);
  }, 60_000);

  it('同時違反 R2、R3、R4:三行 HELD,順序 R2、R3、R4', () => {
    const root = p2Tree([
      T('T1', 'dispatched', 'docs/a/', { cpu: 'heavy' }),
      T('T2', 'dispatched', 'scripts/b.ts'),
      T('T3', 'dispatched', 'apps/desktop/'),
      T('T4', 'todo', 'docs/a/', { cpu: 'heavy' }),
    ]);
    const held = linesStarting(report(root), 'HELD T4 ');
    expect(held).toEqual(['HELD T4 by R2 with T1', 'HELD T4 by R3 with T1', 'HELD T4 by R4 with T1,T2,T3']);
  }, 60_000);

  it('這一輪已經選上的 START 也算「已在跑」:dispatched 2 張 + 兩張互不衝突的 ready → 前一張 START、後一張 HELD by R4 with 已在跑的和前一張', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'scripts/b.ts'), T('T3', 'todo', 'apps/desktop/'), T('T4', 'todo', 'packages/c/')]));
    expect(hasLine(r, 'START T3'), r.stdout).toBe(true);
    expect(hasLine(r, 'HELD T4 by R4 with T1,T2,T3'), r.stdout).toBe(true);
  }, 60_000);

  it('R4 的 3 只數 dispatched:三張 review + 兩張 dispatched 不擋第六張 ready(review 不佔 worker)', () => {
    const r = report(
      p2Tree(
        [T('T1', 'review', 'docs/a/'), T('T2', 'review', 'scripts/b.ts'), T('T3', 'review', 'apps/desktop/'), T('T4', 'dispatched', 'packages/c/'), T('T5', 'dispatched', 'packages/core/src/scheduler/'), T('T6', 'todo', 'features/new/')],
        { landing: [...LANDING, ['features/', 'steps']] },
      ),
    );
    expect(linesStarting(r, 'HELD T6 by R4')).toEqual([]);
    expect(hasLine(r, 'START T6'), r.stdout).toBe(true);
  }, 60_000);

  it('BLOCKED 的工單不 START 也不 HELD(只有 READY 的才進選法)', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'todo', 'docs/a/', { deps: 'T1' })]));
    expect(hasLine(r, 'BLOCKED T2 by T1')).toBe(true);
    expect(linesStarting(r, 'START T2')).toEqual([]);
    expect(linesStarting(r, 'HELD T2')).toEqual([]);
  }, 60_000);

  it('START 的工單 READY 行也在(READY 是 R1、START 是 R2–R4 之後);被 HELD 的 READY 行也在', () => {
    const r = report(p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'docs/b/')]));
    expect(hasLine(r, 'READY T1')).toBe(true);
    expect(hasLine(r, 'READY T2')).toBe(true);
    expect(hasLine(r, 'START T1')).toBe(true);
    expect(hasLine(r, 'HELD T2 by R2 with T1')).toBe(true);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/ready=2 /);
  }, 60_000);

  it('phase 的 WIP:in-progress 兩個擋第三個 ready;只有一個 in-progress 不擋;done / todo / blocked 的不算在跑', () => {
    const f = (rows: [number, string][], folder: string) => ({ folder, rows, next: '**phase-1**:無 gate。' });
    const held = report(p2Tree([], { features: [f([[1, 'in-progress']], '01-alpha'), f([[1, 'in-progress']], '02-beta'), f([[1, 'ready']], '03-gamma')] }));
    expect(hasLine(held, 'HELD 03-gamma/phase-1 by R4 with 01-alpha/phase-1,02-beta/phase-1'), held.stdout).toBe(true);
    const notCounted = report(p2Tree([], { features: [f([[1, 'done']], '01-alpha'), f([[1, 'todo']], '02-beta'), f([[1, 'in-progress']], '04-delta'), f([[1, 'ready']], '03-gamma')] }));
    expect(hasLine(notCounted, 'START 03-gamma/phase-1'), notCounted.stdout).toBe(true);
  }, 120_000);
});

describe('phase-2:依賴與 BLOCKED(must_catch:dropped 被當成滿足 → 依賴它的工單必須印 BLOCKED … (dropped),不得 READY)', () => {
  it('dropped 不算滿足:BLOCKED T2 by T1 (dropped);merged 才算滿足', () => {
    const dropped = report(p2Tree([T('T1', 'dropped', 'docs/a/'), T('T2', 'todo', 'docs/b/', { deps: 'T1' })]));
    expect(hasLine(dropped, 'BLOCKED T2 by T1 (dropped)')).toBe(true);
    expect(linesStarting(dropped, 'READY T2')).toEqual([]);
    expect(linesStarting(dropped, 'START T2')).toEqual([]);
    const merged = report(p2Tree([T('T1', 'merged', 'docs/a/'), T('T2', 'todo', 'docs/b/', { deps: 'T1' })]));
    expect(hasLine(merged, 'READY T2')).toBe(true);
  }, 120_000);

  it('dropped 的後面再依賴一層:第二層擋在它的直接依賴(todo 的 T2),不是 dropped 的 T1', () => {
    const r = report(p2Tree([T('T1', 'dropped', 'docs/a/'), T('T2', 'todo', 'docs/b/', { deps: 'T1' }), T('T3', 'todo', 'scripts/c.ts', { deps: 'T2' })]));
    expect(hasLine(r, 'BLOCKED T3 by T2')).toBe(true);
  }, 60_000);

  it('多個依賴:只列還沒滿足的,自然排序(T2 在 T10 前面);已 merged 的不列', () => {
    const r = report(
      p2Tree([T('T1', 'merged', 'docs/a/'), T('T10', 'dispatched', 'docs/b/'), T('T2', 'review', 'scripts/c.ts'), T('T11', 'todo', 'apps/desktop/', { deps: 'T10, T1, T2' })]),
    );
    expect(hasLine(r, 'BLOCKED T11 by T2,T10'), r.stdout).toBe(true);
  }, 60_000);

  it('依賴 phase(done 才滿足)與整合點 I<N>(有 tag 才滿足,讀真的 git)', () => {
    const features = [{ folder: '10-desktop-shell', rows: [[1, 'done']] as [number, string][], next: '**phase-1**:無 gate。' }];
    const noTag = p2Tree([T('T2', 'todo', 'docs/b/', { deps: 'I4' })], { features });
    expect(hasLine(report(noTag), 'BLOCKED T2 by I4')).toBe(true);
    const tagged = p2Tree([T('T2', 'todo', 'docs/b/', { deps: 'I4' })], { features });
    gitInit(tagged, ['I4']);
    const r = report(tagged);
    expect(hasLine(r, 'READY T2'), r.stdout).toBe(true);
  }, 120_000);

  it('解不開的依賴:PROBLEM unresolved-ref <id> <參照>;依賴不存在的 phase 也一樣', () => {
    const r = checkOf(p2Tree([T('T9', 'todo', 'docs/a/', { deps: 'T404, 99-nowhere/phase-1' })]));
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM unresolved-ref T9 T404')).toBe(true);
    expect(hasLine(r, 'PROBLEM unresolved-ref T9 99-nowhere/phase-1')).toBe(true);
  }, 60_000);

  it('重複 id:PROBLEM duplicate-id <id>,--check 紅', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/')]);
    P2.writeTicket(root, T('T1', 'todo', 'docs/b/'), 'T1-example-2.md');
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM duplicate-id T1')).toBe(true);
  }, 60_000);

  it('工單之間的環(含自己依賴自己):PROBLEM cycle,從自然排序最小的節點起', () => {
    const r = checkOf(p2Tree([T('T2', 'todo', 'docs/a/', { deps: 'T10' }), T('T10', 'todo', 'docs/b/', { deps: 'T2' }), T('T3', 'todo', 'scripts/c.ts', { deps: 'T3' })]));
    expect(r.status).toBe(1);
    expect(hasLine(r, 'PROBLEM cycle T2 -> T10 -> T2')).toBe(true);
    expect(hasLine(r, 'PROBLEM cycle T3 -> T3')).toBe(true);
  }, 60_000);
});

describe('phase-2:R4 / R5 只印 WARN,不紅(must_catch:WARN 場景;R5 深度不把已 done/merged/有 tag 的算進去)', () => {
  const chain = (statuses: string[]): Row[] => statuses.map((st, i) => T(`T${i + 1}`, st, 'docs/a/', { deps: i === 0 ? '' : `T${i}` }));

  it('R5 深度 = 依賴鏈上還沒滿足的節點數(含自己):6 張都 todo → T5 深度 5、T6 深度 6;T4 以內不印', () => {
    const r = checkOf(p2Tree(chain(['todo', 'todo', 'todo', 'todo', 'todo', 'todo'])));
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'WARN r5-depth')).toEqual(['WARN r5-depth T5 5', 'WARN r5-depth T6 6']);
  }, 60_000);

  it('已 merged 的不算:T1、T2 merged → T6 的深度是 4,不印;只有 T1 merged → T6 深度 5,印', () => {
    const ok = report(p2Tree(chain(['merged', 'merged', 'todo', 'todo', 'todo', 'todo'])));
    expect(linesStarting(ok, 'WARN r5-depth')).toEqual([]);
    const warn = report(p2Tree(chain(['merged', 'todo', 'todo', 'todo', 'todo', 'todo'])));
    expect(linesStarting(warn, 'WARN r5-depth')).toEqual(['WARN r5-depth T6 5']);
  }, 120_000);

  it('dispatched / review 的還沒滿足,要算進深度', () => {
    const r = report(p2Tree(chain(['dispatched', 'review', 'todo', 'todo', 'todo'])));
    expect(linesStarting(r, 'WARN r5-depth')).toEqual(['WARN r5-depth T5 5']);
  }, 60_000);

  it('已 done 的 phase 與有 tag 的整合點不算深度:T1 依賴 done 的 phase,T1..T4 鏈 → T4 深度 4,不印', () => {
    const features = [{ folder: '10-desktop-shell', rows: [[1, 'done']] as [number, string][], next: '**phase-1**:無 gate。' }];
    const rows = chain(['todo', 'todo', 'todo', 'todo']);
    rows[0] = { ...rows[0]!, deps: '10-desktop-shell/phase-1, I4' };
    const root = p2Tree(rows, { features });
    gitInit(root, ['I4']);
    const r = report(root);
    expect(linesStarting(r, 'WARN r5-depth')).toEqual([]);
  }, 60_000);

  it('R4 的 dispatched 數量:4 張 → WARN r4-dispatched 4;3 張不印;review 不算', () => {
    const four = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'scripts/b.ts'), T('T3', 'dispatched', 'apps/desktop/'), T('T4', 'dispatched', 'packages/c/')]));
    expect(hasLine(four, 'WARN r4-dispatched 4')).toBe(true);
    const three = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'scripts/b.ts'), T('T3', 'dispatched', 'apps/desktop/'), T('T4', 'review', 'packages/c/')]));
    expect(linesStarting(three, 'WARN r4-dispatched')).toEqual([]);
  }, 120_000);

  it('WARN 不算 PROBLEM:摘要行 problems=0、--check 退出碼 0;WARN 和 PROBLEM 同時有時,退出碼因 PROBLEM 而 1,problems 只數 PROBLEM', () => {
    const warnOnly = checkOf(p2Tree(chain(['todo', 'todo', 'todo', 'todo', 'todo'])));
    expect(warnOnly.status).toBe(0);
    expect(warnOnly.stdout.trimEnd().split('\n').at(-1)).toMatch(/ problems=0$/);
    const both = chain(['todo', 'todo', 'todo', 'todo', 'todo']);
    both.push(T('T9', 'todo', 'nowhere/'));
    const r = checkOf(p2Tree(both));
    expect(r.status).toBe(1);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/ problems=1$/);
    expect(linesStarting(r, 'WARN r5-depth').length).toBeGreaterThan(0);
  }, 120_000);
});

describe('phase-2:檔頭驗證(must_catch:沒有檔頭、欄位缺漏或不合法沒被抓成 PROBLEM / 紅燈)', () => {
  const withHeader = (fields: Record<string, string | undefined>, name = 'T9-example.md', extra = ''): string => {
    const root = p2Tree([]);
    P2.writeRaw(root, `docs/tickets/${name}`, P2.headerFile({ ...P2.DEFAULT_HEADER, ...fields }, extra));
    return root;
  };
  const missing = (field: string): Record<string, undefined> => ({ [field]: undefined });

  it('每個必填欄位缺一個:PROBLEM bad-header T9 missing <欄位>,problems=1,退出碼 1', () => {
    for (const field of ['deps', 'touches', 'cpu', 'budget_usd', 'status', 'owner', 'must_catch']) {
      const r = checkOf(withHeader(missing(field)));
      expect(r.status, field).toBe(1);
      expect(linesStarting(r, 'PROBLEM'), field).toEqual([`PROBLEM bad-header T9 missing ${field}`]);
    }
  }, 300_000);

  it('一次缺兩個欄位:每個缺的各印一行(欄位順序 = 檔頭欄位表的順序)', () => {
    const r = checkOf(withHeader({ cpu: undefined, owner: undefined }));
    expect(linesStarting(r, 'PROBLEM bad-header')).toEqual(['PROBLEM bad-header T9 missing cpu', 'PROBLEM bad-header T9 missing owner']);
  }, 60_000);

  it('欄位值不合法:cpu / status / budget_usd / deps / touches / must_catch / owner,各印 invalid <欄位>', () => {
    const cases: [string, string][] = [
      ['cpu', 'medium'],
      ['cpu', 'Heavy'],
      ['status', 'wip'],
      ['status', 'ready'], // 真樹的 T24 寫過 ready,不是合法值
      ['budget_usd', '-1'],
      ['budget_usd', 'five'],
      ['budget_usd', ''],
      ['deps', 'T1'],
      ['deps', 'T1, T2'],
      ['touches', 'docs/'],
      ['must_catch', 'none'],
      ['owner', 'intern'],
      ['owner', 'worker-grok2'],
      ['cpu', '"light"'], // 引號不支援
      ['deps', '["T1"]'],
    ];
    for (const [field, value] of cases) {
      const r = checkOf(withHeader({ [field]: value }));
      expect(r.status, `${field}: ${value}`).toBe(1);
      expect(hasLine(r, `PROBLEM bad-header T9 invalid ${field}`), `${field}: ${value}\n${r.stdout}`).toBe(true);
    }
  }, 600_000);

  it('合法值全部放行:cpu 兩種、status 五種、owner 七種(含 worker-codex 歷史值與「測試」)、budget_usd 小數與整數', () => {
    const accepted: [string, string][] = [
      ['cpu', 'heavy'],
      ['cpu', 'light'],
      ['status', 'todo'],
      ['status', 'dispatched'],
      ['status', 'review'],
      ['status', 'merged'],
      ['status', 'dropped'],
      ['owner', 'worker-grok'],
      ['owner', 'worker-claude'],
      ['owner', 'worker-codex'],
      ['owner', '統籌'],
      ['owner', '前端'],
      ['owner', '驗收'],
      ['owner', '測試'], // 顧問 2026-10-22:測試 agent 是常設角色,owner 清單加「測試」
      ['budget_usd', '0.5'],
      ['budget_usd', '12'],
    ];
    for (const [field, value] of accepted) {
      const r = checkOf(withHeader({ [field]: value }));
      expect(linesStarting(r, 'PROBLEM'), `${field}: ${value}`).toEqual([]);
      expect(r.status, `${field}: ${value}`).toBe(0);
    }
  }, 600_000);

  it('budget_usd: 0 只對 merged / dropped 合法;todo / dispatched / review 是 invalid budget_usd', () => {
    for (const [status, want] of [['merged', 0], ['dropped', 0], ['todo', 1], ['dispatched', 1], ['review', 1]] as const) {
      const r = checkOf(withHeader({ budget_usd: '0', status }));
      expect(r.status, status).toBe(want);
      if (want === 1) expect(hasLine(r, 'PROBLEM bad-header T9 invalid budget_usd'), status).toBe(true);
    }
  }, 300_000);

  it('id 缺:用檔名當名字(PROBLEM bad-header T9-example.md missing id);id 不合 ^[A-Za-z][A-Za-z0-9_]*$ 也用檔名(invalid id)', () => {
    const noId = checkOf(withHeader(missing('id')));
    expect(hasLine(noId, 'PROBLEM bad-header T9-example.md missing id')).toBe(true);
    for (const bad of ['2nd', 'T-1', 'T 1', 'T.1', '_x', 'T1$']) {
      const r = checkOf(withHeader({ id: bad }));
      expect(r.status, bad).toBe(1);
      expect(hasLine(r, 'PROBLEM bad-header T9-example.md invalid id'), `${bad}\n${r.stdout}`).toBe(true);
    }
    for (const good of ['T2b', 'T2c_1', 'a', 'Z9_9']) {
      expect(checkOf(withHeader({ id: good })).status, good).toBe(0);
    }
  }, 600_000);

  it('沒有檔頭的檔:PROBLEM missing-header <檔名>,--check 紅;空檔、第一行不是 --- 的檔(--- 在後面)都算沒有檔頭', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/T7-old.md', '# 舊工單\n\n沒有檔頭。\n');
    P2.writeRaw(root, 'docs/tickets/T8-empty.md', '');
    P2.writeRaw(root, 'docs/tickets/T9-late.md', '\n---\nid: T9\n---\n');
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM missing-header')).toEqual(['PROBLEM missing-header T7-old.md', 'PROBLEM missing-header T8-empty.md', 'PROBLEM missing-header T9-late.md']);
  }, 60_000);

  it('檔頭是受限 YAML:清單可一行或逐行;行尾 # 註解不算值;must_catch 的項目可以含逗號', () => {
    const root = p2Tree([]);
    P2.writeRaw(
      root,
      'docs/tickets/T9-example.md',
      [
        '---',
        'id: T9   # 名字',
        'deps: []   # 沒有依賴',
        'touches: [docs/a/, scripts/dag.ts]   # 兩個路徑',
        'cpu: heavy',
        'budget_usd: 3',
        'status: todo',
        'owner: 統籌',
        'must_catch:',
        '  - 第一項,有逗號, 再一個逗號',
        '  - 第二項',
        '---',
        '',
        '內文',
        '',
      ].join('\n'),
    );
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'PROBLEM')).toEqual([]);
    expect(hasLine(r, 'LANDING T9 docs')).toBe(true);
  }, 60_000);

  it('逐行清單項目以反引號開頭、或項目中含反引號(含逗號、冒號):照樣有效,當純文字;不報 invalid、--check 不紅(真樹實例:T32 的 must_catch)', () => {
    const root = p2Tree([]);
    P2.writeRaw(
      root,
      'docs/tickets/T9-example.md',
      [
        '---',
        'id: T9',
        'deps: []',
        'touches: [docs/a/]',
        'cpu: light',
        'budget_usd: 1',
        'status: todo',
        'owner: worker-grok',
        'must_catch:',
        '  - `.progress` 照舊在 stdout 以外的地方,不能只看第一行',
        '  - 把 `a, b` 拆成兩項:逗號在反引號裡,冒號 `key: value` 也不是新欄位',
        '  - 一般項目裡有 `反引號` 在中間',
        '---',
        '',
        '內文',
        '',
      ].join('\n'),
    );
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'PROBLEM')).toEqual([]);
    expect(hasLine(r, 'LANDING T9 docs')).toBe(true);
  }, 60_000);

  it('逐行寫的 deps / touches 也一樣:項目以反引號開頭的清單行不會讓檔頭變 invalid', () => {
    const root = p2Tree([T('T1', 'merged', 'docs/z/')]);
    P2.writeRaw(
      root,
      'docs/tickets/T9-example.md',
      ['---', 'id: T9', 'deps:', '  - T1', 'touches:', '  - docs/a/', '  - scripts/dag.ts', 'cpu: light', 'budget_usd: 1', 'status: todo', 'owner: worker-grok', 'must_catch:', '  - `第一項`', '---', ''].join('\n'),
    );
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'READY T9')).toBe(true);
  }, 60_000);

  it('一行清單裡的註解不吃掉後面的項目,也不被當成項目:touches: [docs/a/] # [scripts/x.ts] 只有 docs/a/', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/T9-example.md', P2.headerFile({ ...P2.DEFAULT_HEADER, touches: '[docs/a/]   # [nowhere/x/]' }));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'PROBLEM')).toEqual([]);
  }, 60_000);

  it('內文裡像檔頭的東西不影響:檔頭結束後又有一段 --- … --- 不被當成檔頭欄位', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/T9-example.md', `${P2.headerFile(P2.DEFAULT_HEADER)}\n---\nstatus: wip\n---\n`);
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
  }, 60_000);
});

describe('phase-2:退出碼與旗標', () => {
  it('沒有 --check 時 PROBLEM 只是報告,退出碼 0;有 --check 才變 1;--check 放在 --root 前面或後面一樣', () => {
    const root = p2Tree([T('T9', 'todo', 'nowhere/')]);
    expect(report(root).status).toBe(0);
    expect(P2.runDagCli(['--root', root, '--check']).status).toBe(1);
    expect(P2.runDagCli(['--check', '--root', root]).status).toBe(1);
  }, 120_000);

  it('--check 沒有問題時退出碼 0;摘要行照舊 gate=dag result=OK(PROBLEM 不改 result)', () => {
    const ok = checkOf(p2Tree([T('T1', 'todo', 'docs/a/')]));
    expect(ok.status).toBe(0);
    expect(ok.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=0 human=0 problems=0');
    const bad = checkOf(p2Tree([T('T9', 'todo', 'nowhere/')]));
    expect(bad.stdout.trimEnd().split('\n').at(-1)).toMatch(/^gate=dag result=OK ready=1 blocked=0 human=0 problems=1$/);
  }, 120_000);

  it('摘要行的 ready 數 = READY 行數(含被 HELD 的),blocked = BLOCKED 行數,problems = PROBLEM 行數', () => {
    const r = checkOf(p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'docs/b/'), T('T3', 'todo', 'scripts/c.ts', { deps: 'T1' }), T('T4', 'todo', 'nowhere/')]));
    const count = (kw: string): number => linesStarting(r, `${kw} `).length;
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe(`gate=dag result=OK ready=${count('READY')} blocked=${count('BLOCKED')} human=0 problems=${count('PROBLEM')}`);
    expect(count('READY')).toBe(3);
    expect(count('BLOCKED')).toBe(1);
  }, 60_000);

  it('phase-1 的樹(沒有 docs/tickets、沒有落點表)照舊:--check 退出碼 0、problems=0、不出 PROBLEM', () => {
    const r = P2.runDagCli(['--root', copyFixture('dag-p2-compat'), '--check']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(linesStarting(r, 'PROBLEM')).toEqual([]);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=2 human=0 problems=0');
  }, 60_000);
});

describe('phase-2:輸出固定、只讀(must_catch:工具寫任何檔 → 前後樹逐位元組相同的場景必須紅)', () => {
  const richTree = (reverse = false): string => {
    const rows = [T('T1', 'merged', 'docs/a/'), T('T2', 'todo', 'scripts/b.ts', { deps: 'T1' }), T('T10', 'dispatched', 'apps/desktop/'), T('T3', 'todo', 'docs/c/'), T('T4', 'review', 'packages/c/', { cpu: 'heavy' }), T('T5', 'dropped', 'docs/z/')];
    return p2Tree(reverse ? [...rows].reverse() : rows, { features: [{ folder: '01-alpha', rows: [[1, 'ready']], next: '**phase-1**:無 gate。' }] });
  };

  it('三種模式(報告、--check、--orca)跑完,樹的每個位元組都沒變、沒有檔案增減(含沒有暫存檔)', () => {
    for (const flags of [[], ['--check'], ['--orca'], ['--check', '--orca']]) {
      const root = richTree();
      const before = snapshot(root);
      const r = P2.runDagCli(['--root', root, ...flags]);
      expect(r.status, flags.join(' ') + r.stderr).toBe(0);
      expect(snapshot(root), flags.join(' ')).toEqual(before);
    }
  }, 300_000);

  it('同一棵樹跑兩次輸出逐位元組相同;工單檔的建立順序不影響輸出', () => {
    const a = richTree();
    const out1 = P2.runDagCli(['--root', a, '--check']).stdout;
    const out2 = P2.runDagCli(['--root', a, '--check']).stdout;
    expect(out2).toBe(out1);
    const b = richTree(true);
    expect(P2.runDagCli(['--root', b, '--check']).stdout).toBe(out1);
    expect(P2.runDagCli(['--root', b, '--orca']).stdout).toBe(P2.runDagCli(['--root', a, '--orca']).stdout);
  }, 300_000);

  it('原始碼沒有 fs 的寫入 API,也不 import 別的腳本(phase-2 後仍然成立;dag-check.ts 若存在也一樣)', () => {
    const banned = /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdtempSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|truncateSync|symlinkSync|openSync)\b/;
    for (const file of ['scripts/dag.ts', 'scripts/dag-check.ts']) {
      const p = join(REPO_ROOT, file);
      if (!existsSync(p)) continue;
      const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      expect(code, file).not.toMatch(banned);
      const specs = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of specs) expect(spec, `${file} import ${spec}`).toMatch(/^node:|^\.\/dag(-check)?\.js$/);
    }
  });
});

describe('phase-2:--orca(must_catch 之外的規格:只印、拓樸序、同層自然排序、只含 todo、已 merged 的依賴不列)', () => {
  const orcaOut = (tickets: Row[]): string[] => P2.runDagCli(['--root', p2Tree(tickets), '--orca']).stdout.split('\n').filter((l) => l !== '');
  const file = (id: string): string => P2.ticketFileName(id);

  it('輸出是一段可以直接執行的 bash:每一行不是 task-create 就是 # 註解;沒有 READY / 摘要行;退出碼 0', () => {
    const r = P2.runDagCli(['--root', p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'scripts/b.ts', { deps: 'T1' })]), '--orca']);
    expect(r.status).toBe(0);
    for (const l of r.stdout.split('\n').filter((x) => x !== '')) expect(P2.isTaskLine(l) || l.startsWith('#'), l).toBe(true);
    expect(r.stdout).not.toContain('gate=dag');
  }, 60_000);

  it('照量過的 jq 路徑 .result.task.id;每張一行;無依賴 --deps "[]";依賴用前面已建好的變數', () => {
    const out = orcaOut([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'scripts/b.ts', { deps: 'T1' })]);
    expect(out.filter(P2.isTaskLine)).toEqual([P2.orcaLine('T1', file('T1'), []), P2.orcaLine('T2', file('T2'), ['T1'])]);
    expect(out.join('\n')).toContain(".result.task.id");
  }, 60_000);

  it('拓樸序、同層自然排序:T1、T3 在第 0 層(T1 先),T2 在第 1 層,T10 在第 2 層', () => {
    const out = orcaOut([T('T10', 'todo', 'apps/desktop/', { deps: 'T2' }), T('T2', 'todo', 'scripts/b.ts', { deps: 'T1' }), T('T3', 'todo', 'docs/c/'), T('T1', 'todo', 'docs/a/')]);
    const ids = out.filter(P2.isTaskLine).map((l) => l.split('=')[0]);
    expect(ids).toEqual(['T1', 'T3', 'T2', 'T10']);
  }, 60_000);

  it('只含 status: todo 的:merged / dropped / dispatched / review 不建 task;merged 的依賴不列進 --deps', () => {
    const out = orcaOut([T('T1', 'merged', 'docs/a/'), T('T2', 'dispatched', 'scripts/b.ts'), T('T6', 'review', 'packages/c/'), T('T7', 'dropped', 'docs/z/'), T('T3', 'todo', 'apps/desktop/', { deps: 'T1, T2, T6' })]);
    expect(out.filter(P2.isTaskLine)).toEqual([P2.orcaLine('T3', file('T3'), [])]);
  }, 60_000);

  it('依賴好幾張要建的 todo:--deps 裡每個變數都在,順序照自然排序;沒有要建的就沒有任何 task 行', () => {
    const out = orcaOut([T('T1', 'todo', 'docs/a/'), T('T2', 'todo', 'scripts/b.ts'), T('T3', 'todo', 'apps/desktop/', { deps: 'T2, T1' })]);
    const t3 = out.find((l) => l.startsWith('T3='))!;
    expect(t3).toMatch(/--deps "\[\\"\$T1\\",\s*\\"\$T2\\"\]"/);
    expect(orcaOut([T('T1', 'merged', 'docs/a/')]).filter(P2.isTaskLine)).toEqual([]);
  }, 60_000);

  it('不執行 orca:PATH 最前面放一支記錄呼叫的假 orca,跑完它一次都沒被叫到', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/')]);
    const stub = P2.makeOrcaStub(mkTmp('dag-p2-stub'));
    const r = P2.runDagCli(['--root', root, '--orca'], { PATH: `${stub.dir}:${process.env.PATH ?? ''}` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('task-create');
    expect(P2.stubWasCalled(stub.log)).toBe(false);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// phase-2 補測(T39 驗收的變異存活者,scripts/dag.ts 663–1258)。
// 只新增、不動上面任何一條斷言。全部走 CLI(--root / --check / --orca),跟上面同一個規則。
// 每個 describe 開頭標了它對應 docs/reviews/acceptance-T39.md 第 5 節的哪一類存活者。
// 手法:檔名順序 ≠ 工單 id 的自然順序,輸出才看得出排序(輸入順序碰巧對就殺不掉「不排序」的變異)。
// ═══════════════════════════════════════════════════════════════════════════════════════
const hdr = (fields: Record<string, string | undefined>): string => P2.headerFile({ ...P2.DEFAULT_HEADER, ...fields });
const putTicket = (root: string, file: string, fields: Record<string, string | undefined>): void => P2.writeRaw(root, `docs/tickets/${file}`, hdr(fields));
/** 報告本文:`PROBLEM` 以外的行(去掉 mermaid 區塊與結尾摘要) */
const bodyLines = (r: { stdout: string }): string[] => r.stdout.split('\n').slice(0, r.stdout.split('\n').indexOf('```mermaid'));
const edgeLines = (r: { stdout: string }): string[] => {
  const all = r.stdout.split('\n');
  return all.slice(all.indexOf('graph TD') + 1, all.indexOf('```', all.indexOf('graph TD')));
};

describe('補測·存活者 1:PROBLEM 行排序(compareRecord:換成 () => 0 要紅)', () => {
  it('不同工單:依 id 自然排序(T3、T4、T20),不是檔名順序;同一張工單依檔頭欄位表的順序(deps、budget_usd、status),不是字母順序', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-a.md', { id: 'T20', cpu: undefined });
    putTicket(root, 'T2-b.md', { id: 'T3', deps: undefined, budget_usd: undefined, status: undefined });
    putTicket(root, 'T4-c.md', { id: 'T4', deps: undefined, cpu: 'medium' });
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual([
      'PROBLEM bad-header T3 missing deps',
      'PROBLEM bad-header T3 missing budget_usd',
      'PROBLEM bad-header T3 missing status',
      'PROBLEM bad-header T4 missing deps',
      'PROBLEM bad-header T4 invalid cpu',
      'PROBLEM bad-header T20 missing cpu',
    ]);
  }, 60_000);

  it('同一張工單 missing 與 invalid 混著:照欄位表的順序排,不是 invalid 在前(字母序)也不是 missing 在前', () => {
    const root = p2Tree([]);
    putTicket(root, 'T9-x.md', { id: 'T9', owner: 'intern', touches: undefined, cpu: 'medium', status: undefined });
    const r = checkOf(root);
    expect(linesStarting(r, 'PROBLEM')).toEqual([
      'PROBLEM bad-header T9 missing touches',
      'PROBLEM bad-header T9 invalid cpu',
      'PROBLEM bad-header T9 missing status',
      'PROBLEM bad-header T9 invalid owner',
    ]);
  }, 60_000);

  it('不同種類的 PROBLEM 混在一起:依「種類之後的字串」自然排序(bad-header < cycle < duplicate-id < no-landing < unresolved-ref;T8 在 T13 前)', () => {
    const root = p2Tree([
      T('T5', 'todo', 'docs/a/', { deps: 'T6' }),
      T('T6', 'todo', 'docs/b/', { deps: 'T5' }),
      T('T7', 'todo', 'zzz/'),
      T('T8', 'todo', 'docs/c/', { deps: 'X99' }),
      T('T13', 'merged', 'zzz/', { deps: 'Y77' }),
    ]);
    P2.writeTicket(root, T('T11', 'todo', 'docs/d/'), 'T11-a.md');
    P2.writeTicket(root, T('T11', 'todo', 'docs/e/'), 'T11-b.md');
    putTicket(root, 'T12-bad.md', { id: 'T12', cpu: undefined });
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual([
      'PROBLEM bad-header T12 missing cpu',
      'PROBLEM cycle T5 -> T6 -> T5',
      'PROBLEM duplicate-id T11',
      'PROBLEM no-landing T7 zzz/',
      'PROBLEM unresolved-ref T8 X99',
      'PROBLEM unresolved-ref T13 Y77',
    ]);
    // 環上的工單不得 READY / START(只出 BLOCKED);已 merged 的 T13 對不到落點不出 no-landing,但解不開的參照照報
    for (const id of ['T5', 'T6']) {
      expect(linesStarting(r, `READY ${id}`), id).toEqual([]);
      expect(linesStarting(r, `START ${id}`), id).toEqual([]);
    }
    expect(hasLine(r, 'BLOCKED T5 by T6')).toBe(true);
    expect(hasLine(r, 'BLOCKED T6 by T5')).toBe(true);
  }, 60_000);
});

describe('補測·存活者 1:READY / START / LANDING / BLOCKED / WARN 行與邊的排序(augment 的 sort)', () => {
  it('READY、START、LANDING 都依 id 自然排序(T2、T9、T10),完整本文逐行比對(種類順序 READY → START → LANDING)', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-a.md', { id: 'T10', touches: '[docs/a/]' });
    putTicket(root, 'T2-b.md', { id: 'T2', touches: '[apps/desktop/]' });
    putTicket(root, 'T3-c.md', { id: 'T9', touches: '[packages/core/src/scheduler/due.ts]' });
    const r = report(root);
    expect(bodyLines(r)).toEqual([
      'READY T2',
      'READY T9',
      'READY T10',
      'START T2',
      'START T9',
      'START T10',
      'LANDING T2 10-desktop-shell',
      'LANDING T9 04-scheduler',
      'LANDING T10 docs',
    ]);
  }, 60_000);

  it('BLOCKED 依 id 自然排序;邊依(起點、終點)自然排序:T2→T3 在 T2→T10 前,T1→T2 在 T2→… 前', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-a.md', { id: 'T10', deps: '[T2]', touches: '[docs/a/]' });
    putTicket(root, 'T2-b.md', { id: 'T3', deps: '[T2]', touches: '[apps/desktop/]' });
    putTicket(root, 'T3-c.md', { id: 'T2', deps: '[T1]', touches: '[scripts/a.ts]' });
    putTicket(root, 'T4-d.md', { id: 'T1', touches: '[packages/core/x.ts]' });
    const r = report(root);
    expect(linesStarting(r, 'BLOCKED')).toEqual(['BLOCKED T2 by T1', 'BLOCKED T3 by T2', 'BLOCKED T10 by T2']);
    expect(edgeLines(r)).toEqual(['    "T1" --> "T2"', '    "T2" --> "T3"', '    "T2" --> "T10"']);
  }, 60_000);

  it('依賴 phase 的邊也進圖,跟工單之間的邊一起排序(phase 節點的名字在 T 開頭之前)', () => {
    const features = [{ folder: '10-desktop-shell', rows: [[1, 'done']] as [number, string][], next: '**phase-1**:無 gate。' }];
    const root = p2Tree([T('T2', 'todo', 'docs/b/', { deps: '10-desktop-shell/phase-1' }), T('T1', 'todo', 'scripts/a.ts', { deps: 'T2' })], { features });
    const r = report(root);
    expect(edgeLines(r)).toEqual(['    "10-desktop-shell/phase-1" --> "T2"', '    "T2" --> "T1"']);
    expect(hasLine(r, 'READY T2')).toBe(true);
    expect(hasLine(r, 'BLOCKED T1 by T2')).toBe(true);
  }, 60_000);

  it('R5 深度:鏈長 4 不出 WARN,第 5 層起出 WARN r5-depth <id> <深度>,依 id 自然排序(T9 在 T10 前);只有 WARN,--check 退出碼 0', () => {
    const root = p2Tree([]);
    // T5 ← T6 ← T7 ← T8 ← T9 ← T10 ← T11:深度 1…7;檔名順序故意反過來
    const ids = ['T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11'];
    const landings = ['docs/a/', 'docs/b/', 'docs/c/', 'docs/d/', 'docs/e/', 'docs/f/', 'docs/g/'];
    ids.forEach((id, i) => putTicket(root, `T${20 - i}-chain.md`, { id, deps: i === 0 ? '[]' : `[${ids[i - 1]}]`, touches: `[${landings[i]}]` }));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'WARN')).toEqual(['WARN r5-depth T9 5', 'WARN r5-depth T10 6', 'WARN r5-depth T11 7']);
    expect(linesStarting(r, 'PROBLEM')).toEqual([]);
  }, 60_000);

  it('R5 深度:已 merged 的依賴算 0,不把後面的鏈墊高(T1 merged ← T2 ← T3 ← T4 ← T5 ← T6:T6 只有深度 5,T5 不 WARN)', () => {
    const root = p2Tree([
      T('T1', 'merged', 'docs/a/'),
      T('T2', 'todo', 'docs/b/', { deps: 'T1' }),
      T('T3', 'todo', 'docs/c/', { deps: 'T2' }),
      T('T4', 'todo', 'docs/d/', { deps: 'T3' }),
      T('T5', 'todo', 'docs/e/', { deps: 'T4' }),
      T('T6', 'todo', 'docs/f/', { deps: 'T5' }),
    ]);
    const r = report(root);
    expect(linesStarting(r, 'WARN')).toEqual(['WARN r5-depth T6 5']);
  }, 60_000);

  it('R5 深度:依賴環不會讓深度算不完(環上的工單照樣出 PROBLEM cycle,程式不當掉、退出碼是 1 不是 2)', () => {
    const r = checkOf(p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'T2' }), T('T2', 'todo', 'docs/b/', { deps: 'T1' })]));
    expect(r.status, r.stderr).toBe(1);
    expect(hasLine(r, 'PROBLEM cycle T1 -> T2 -> T1')).toBe(true);
  }, 60_000);
});

describe('補測·存活者 5:R2 / R3 / R4 的 HELD 行(只有 R2、只有 R3、兩者並印、id 順序、數 review、數本輪已選)', () => {
  it('只有 R2:HELD T20 by R2 with T2,T10(自然排序,不是檔名順序);沒有 R3 行;R2 的 PROBLEM 兩端也是自然排序', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-a.md', { id: 'T10', status: 'dispatched', touches: '[docs/a/]' });
    putTicket(root, 'T2-b.md', { id: 'T2', status: 'dispatched', touches: '[docs/b/]' });
    putTicket(root, 'T3-c.md', { id: 'T20', status: 'todo', touches: '[docs/c/]' });
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T20 by R2 with T2,T10']);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM r2-overlap T2 T10 on docs']);
    expect(linesStarting(r, 'START T20')).toEqual([]);
  }, 60_000);

  it('只有 R3(落點不相交的兩張重活):HELD T20 by R3 with T2,T10;dispatched 與 review 都算;沒有 R2 行;r3-heavy 兩端自然排序', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-a.md', { id: 'T10', status: 'review', cpu: 'heavy', touches: '[scripts/a.ts]' });
    putTicket(root, 'T2-b.md', { id: 'T2', status: 'dispatched', cpu: 'heavy', touches: '[apps/desktop/]' });
    putTicket(root, 'T3-c.md', { id: 'T20', status: 'todo', cpu: 'heavy', touches: '[docs/a/]' });
    const r = checkOf(root);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T20 by R3 with T2,T10']);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM r3-heavy T2 T10']);
  }, 60_000);

  it('R3 只數重活:輕活佔著不算;todo 的重活不算佔著', () => {
    const root = p2Tree([T('T1', 'dispatched', 'apps/desktop/', { cpu: 'light' }), T('T2', 'todo', 'scripts/a.ts', { cpu: 'heavy' }), T('T3', 'todo', 'docs/a/', { cpu: 'heavy' })]);
    const r = report(root);
    expect(hasLine(r, 'START T2')).toBe(true);
    expect(linesStarting(r, 'HELD T2')).toEqual([]);
    // 本輪已選的 T2 是重活,T3 也是重活 → T3 被 T2 擋(R3 數「這輪已選」的)
    expect(linesStarting(r, 'HELD T3')).toEqual(['HELD T3 by R3 with T2']);
  }, 60_000);

  it('R2 與 R3 同時違反:兩行都印,R2 在前、R3 在後', () => {
    const root = p2Tree([T('T1', 'dispatched', 'docs/a/', { cpu: 'heavy' }), T('T2', 'todo', 'docs/b/', { cpu: 'heavy' })]);
    const r = report(root);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T2 by R2 with T1', 'HELD T2 by R3 with T1']);
  }, 60_000);

  it('R2 也數本輪已選的:兩張輕活都是 docs → T3 START,T4 HELD T4 by R2 with T3', () => {
    const r = report(p2Tree([T('T3', 'todo', 'docs/a/'), T('T4', 'todo', 'docs/b/')]));
    expect(hasLine(r, 'START T3')).toBe(true);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T4 by R2 with T3']);
  }, 60_000);

  it('R4:跑著 3 張 dispatched → 下一張 HELD by R4 with 它們(自然排序),剛好 3 張不出 WARN', () => {
    const r = checkOf(
      p2Tree([T('T10', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/'), T('T3', 'dispatched', 'scripts/a.ts'), T('T4', 'todo', 'packages/core/x.ts')]),
    );
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T4 by R4 with T2,T3,T10']);
    expect(linesStarting(r, 'WARN')).toEqual([]);
  }, 60_000);

  it('R4:4 張 dispatched 出 WARN r4-dispatched 4,不紅;review 不算在 R4 的數量裡', () => {
    const four = checkOf(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/'), T('T3', 'dispatched', 'scripts/a.ts'), T('T4', 'dispatched', 'packages/core/x.ts')]));
    expect(four.status, four.stdout).toBe(0);
    expect(linesStarting(four, 'WARN')).toEqual(['WARN r4-dispatched 4']);
    const withReview = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/'), T('T3', 'review', 'scripts/a.ts'), T('T4', 'todo', 'packages/core/x.ts')]));
    expect(hasLine(withReview, 'START T4')).toBe(true);
    expect(linesStarting(withReview, 'WARN')).toEqual([]);
  }, 120_000);

  it('R4 也數本輪已選的:1 張 dispatched + 這輪選了 2 張 → 第 4 張 HELD by R4 with T1,T2,T3(dispatched 加已選,自然排序)', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'todo', 'apps/desktop/'), T('T3', 'todo', 'scripts/a.ts'), T('T4', 'todo', 'packages/core/x.ts')]));
    expect(linesStarting(r, 'START')).toEqual(['START T2', 'START T3']);
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T4 by R4 with T1,T2,T3']);
  }, 60_000);

  it('R2 只在至少一邊是 dispatched 時成立:review 對 review 同落點不出 PROBLEM;review 對 dispatched 才出', () => {
    const rr = checkOf(p2Tree([T('T1', 'review', 'docs/a/'), T('T2', 'review', 'docs/b/')]));
    expect(rr.status, rr.stdout).toBe(0);
    expect(linesStarting(rr, 'PROBLEM')).toEqual([]);
    const rd = checkOf(p2Tree([T('T1', 'review', 'docs/a/'), T('T2', 'dispatched', 'docs/b/')]));
    expect(rd.status).toBe(1);
    expect(linesStarting(rd, 'PROBLEM')).toEqual(['PROBLEM r2-overlap T1 T2 on docs']);
  }, 120_000);

  it('R3 的 PROBLEM:review 對 review 兩張重活也算(r3-heavy),只有一張重活不算', () => {
    const two = checkOf(p2Tree([T('T1', 'review', 'docs/a/', { cpu: 'heavy' }), T('T2', 'review', 'apps/desktop/', { cpu: 'heavy' })]));
    expect(linesStarting(two, 'PROBLEM')).toEqual(['PROBLEM r3-heavy T1 T2']);
    const one = checkOf(p2Tree([T('T1', 'review', 'docs/a/', { cpu: 'heavy' }), T('T2', 'review', 'apps/desktop/', { cpu: 'light' })]));
    expect(linesStarting(one, 'PROBLEM')).toEqual([]);
  }, 120_000);

  it('phase 的 R4(WIP ≤ 2):已有 2 個 in-progress → ready 的 phase HELD by R4 with 它們;只有 1 個 → START', () => {
    const next = '**phase-3**:無 gate。';
    const full = report(p2Tree([], { features: [{ folder: '01-alpha', rows: [[1, 'in-progress'], [2, 'in-progress'], [3, 'todo']], next }] }));
    expect(linesStarting(full, 'HELD')).toEqual(['HELD 01-alpha/phase-3 by R4 with 01-alpha/phase-1,01-alpha/phase-2']);
    expect(linesStarting(full, 'START')).toEqual([]);
    const one = report(p2Tree([], { features: [{ folder: '01-alpha', rows: [[1, 'in-progress'], [2, 'done'], [3, 'todo']], next }] }));
    expect(linesStarting(one, 'START')).toEqual(['START 01-alpha/phase-3']);
    expect(linesStarting(one, 'HELD')).toEqual([]);
  }, 120_000);
});

describe('補測·存活者 6:overlapReasons 的落點互斥細節(infra 檔案層級、多個原因的順序)', () => {
  const pair = (a: string, b: string): string[] =>
    linesStarting(checkOf(p2Tree([T('T1', 'dispatched', a), T('T2', 'dispatched', b)])), 'PROBLEM');

  it('infra 同一個檔案才算重疊:scripts/a.ts 對 scripts/b.ts 不出 PROBLEM;同檔出 on infra:<檔>', () => {
    expect(pair('scripts/a.ts', 'scripts/b.ts')).toEqual([]);
    expect(pair('scripts/a.ts', 'scripts/a.ts')).toEqual(['PROBLEM r2-overlap T1 T2 on infra:scripts/a.ts']);
  }, 120_000);

  it('infra 目錄涵蓋底下的檔案,左右兩個方向都算:目錄在左 / 目錄在右 → on infra:scripts/', () => {
    expect(pair('scripts/', 'scripts/dag.ts')).toEqual(['PROBLEM r2-overlap T1 T2 on infra:scripts/']);
    expect(pair('scripts/dag.ts', 'scripts/')).toEqual(['PROBLEM r2-overlap T1 T2 on infra:scripts/']);
  }, 120_000);

  it('infra 與一般落點、infra 與 contracts 不互相當成一般落點交集:只有 infra 的兩張(不同檔)沒有 on infra、也沒有 on <落點>', () => {
    expect(pair('scripts/a.ts', 'docs/x/')).toEqual([]);
    expect(pair('scripts/a.ts', 'scripts/b.ts')).not.toContain('PROBLEM r2-overlap T1 T2 on infra');
  }, 120_000);

  it('多個原因各印一行,依字串自然排序(core、docs、infra:…);左右兩張的落點都含全部時也一樣', () => {
    const touches = 'packages/core/x.ts, docs/y/, scripts/q.ts';
    expect(pair(touches, touches)).toEqual([
      'PROBLEM r2-overlap T1 T2 on core',
      'PROBLEM r2-overlap T1 T2 on docs',
      'PROBLEM r2-overlap T1 T2 on infra:scripts/q.ts',
    ]);
  }, 60_000);

  it('contracts 跟任何在跑的工單都互斥(包含只碰 infra 的),而且只印一行 on contracts', () => {
    expect(pair('contracts/types.md', 'scripts/a.ts')).toEqual(['PROBLEM r2-overlap T1 T2 on contracts']);
    expect(pair('scripts/a.ts', 'contracts/types.md')).toEqual(['PROBLEM r2-overlap T1 T2 on contracts']);
    expect(pair('contracts/types.md', 'contracts/other.md')).toEqual(['PROBLEM r2-overlap T1 T2 on contracts']);
  }, 120_000);
});

describe('補測·存活者 6:整合點 I<N> 的正規式要有頭有尾(classifyDep / satisfied)', () => {
  it('I4x、xI4、I 不是整合點:各出 PROBLEM unresolved-ref,不當成 BLOCKED by <它>,也不因此 READY', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I4x' }), T('T2', 'todo', 'docs/b/', { deps: 'xI4' }), T('T3', 'todo', 'scripts/a.ts', { deps: 'I' })]);
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM unresolved-ref T1 I4x', 'PROBLEM unresolved-ref T2 xI4', 'PROBLEM unresolved-ref T3 I']);
    expect(linesStarting(r, 'BLOCKED')).toEqual([]);
    expect(linesStarting(r, 'READY')).toEqual([]);
  }, 60_000);

  it('I4(沒 tag)擋住;打了 tag I4 就放行;tag 叫 I4x 不算 I4(完全相同才算)', () => {
    const blocked = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I4' })]);
    expect(hasLine(report(blocked), 'BLOCKED T1 by I4')).toBe(true);
    const wrongTag = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I4' })]);
    gitInit(wrongTag, ['I4x']);
    expect(hasLine(report(wrongTag), 'BLOCKED T1 by I4')).toBe(true);
    const ok = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I4' })]);
    gitInit(ok, ['I4']);
    expect(hasLine(report(ok), 'READY T1')).toBe(true);
  }, 120_000);

  it('I10 這種兩位數也是整合點(不是只認一位數)', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I10' })]);
    expect(hasLine(report(root), 'BLOCKED T1 by I10')).toBe(true);
    gitInit(root, ['I10']);
    expect(hasLine(report(root), 'READY T1')).toBe(true);
  }, 120_000);
});

describe('補測·存活者 3:落點檔載入的壞檔與缺檔(loadLandings:一律當空表,不當掉)', () => {
  const touches = 'a/, b/, c/';
  const withLanding = (write: (root: string) => void): { status: number | null; stdout: string; stderr: string } => {
    const root = p2Tree([T('T1', 'todo', touches)], { landing: null });
    write(root);
    return checkOf(root);
  };
  const allNoLanding = ['PROBLEM no-landing T1 a/', 'PROBLEM no-landing T1 b/', 'PROBLEM no-landing T1 c/'];
  const ownersFile = (root: string, text: string): void => P2.writeRaw(root, 'scripts/boundaries.owners.json', text);

  it('檔案不存在:每個 touches 都 no-landing,退出碼 1(不是 2,不當掉)', () => {
    const r = withLanding(() => undefined);
    expect(r.status, r.stderr).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(allNoLanding);
  }, 60_000);

  it('路徑是個目錄、不是檔案:當空表', () => {
    const r = withLanding((root) => mkdirSync(join(root, 'scripts/boundaries.owners.json'), { recursive: true }));
    expect(r.status, r.stderr).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(allNoLanding);
  }, 60_000);

  it('JSON 壞掉:當空表', () => {
    const r = withLanding((root) => ownersFile(root, '{ "owners": [ ["a/", "x"], '));
    expect(r.status, r.stderr).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(allNoLanding);
  }, 60_000);

  it('owners 不是陣列(物件、字串、整個檔是陣列):當空表', () => {
    for (const text of ['{ "owners": { "a/": "x" } }', '{ "owners": "a/" }', '[["a/", "x"]]', '{ "other": [["a/", "x"]] }', 'null']) {
      const r = withLanding((root) => ownersFile(root, text));
      expect(r.status, `${text}: ${r.stderr}`).toBe(1);
      expect(linesStarting(r, 'PROBLEM'), text).toEqual(allNoLanding);
    }
  }, 300_000);

  it('列的型別不對的列略過、對的列照用:["a/","x"] 有效;[1,"x"]、["b/",2]、"c/"、["c/"] 都略過', () => {
    const r = withLanding((root) => ownersFile(root, JSON.stringify({ owners: [['a/', 'x'], [1, 'x'], ['b/', 2], 'c/', ['c/']] })));
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 x']);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM no-landing T1 b/', 'PROBLEM no-landing T1 c/']);
  }, 60_000);
});

describe('補測·存活者 3:touches 對落點(resolveTouch 的目錄涵蓋、同一張多條 touches)', () => {
  it('touches 是目錄(以 / 結尾):它自己的最長前綴落點,加上底下每一列的落點;LANDING 一個落點一行、依字串排序', () => {
    const r = report(p2Tree([T('T1', 'todo', 'packages/')]));
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 04-scheduler', 'LANDING T1 core']);
  }, 60_000);

  it('同一張工單有好幾條 touches:每條各自找落點,同一個落點只印一次;只有對不到的那一條出 no-landing', () => {
    const r = checkOf(p2Tree([T('T1', 'todo', 'docs/a/, docs/b/, apps/desktop/x.ts, nowhere/y.ts')]));
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 10-desktop-shell', 'LANDING T1 docs']);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM no-landing T1 nowhere/y.ts']);
  }, 60_000);

  it('touches 比前綴短、或只是前綴的一部分,都對不到(contract 不是 contracts/);沒有 touches 的工單不出 LANDING 也不出 no-landing', () => {
    const r = checkOf(p2Tree([T('T1', 'todo', 'contract'), T('T2', 'todo', '')]));
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM no-landing T1 contract']);
    expect(linesStarting(r, 'LANDING')).toEqual([]);
  }, 60_000);

  it('touches 完全等於一個前綴也算(contracts/ 對 contracts/)', () => {
    const r = report(p2Tree([T('T1', 'todo', 'contracts/')]));
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 contracts']);
  }, 60_000);
});

describe('補測·存活者 2:檔頭解析的邊角(parseHeaderText / stripKeyComment / parseInlineList / scalarUnsupported)', () => {
  const fileText = (lines: string[], eol = '\n'): string => `---${eol}${lines.join(eol)}${eol}---${eol}${eol}# 內文${eol}`;
  const base = (over: Record<string, string | undefined>): string[] => {
    const all: Record<string, string | undefined> = { ...P2.DEFAULT_HEADER, ...over };
    return ['id', 'deps', 'touches', 'cpu', 'budget_usd', 'status', 'owner', 'must_catch'].filter((k) => all[k] !== undefined).map((k) => `${k}: ${all[k]}`);
  };

  it('空行、# 註解行(含縮排的)、不是 key: value 的雜訊行、不認得的鍵:都略過,檔頭仍合法(READY、有 LANDING)', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/V1.md', fileText(['', '# 註解', 'id: V1', '   # 縮排的註解', 'deps: []', '', '這一行是雜訊,沒有冒號', 'Extra: 不認得的鍵', 'touches: [docs/a/]', ...base({}).slice(3)]));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'READY V1')).toBe(true);
    expect(hasLine(r, 'LANDING V1 docs')).toBe(true);
  }, 60_000);

  it('行尾註解(空白後的 #)切掉;沒有空白的 # 是值的一部分(docs/a#b/ 對得到 docs)', () => {
    const root = p2Tree([]);
    P2.writeRaw(
      root,
      'docs/tickets/V2.md',
      fileText(['id: V2 # 工單 id', 'deps: [] # 沒有依賴', 'touches: [docs/a#b/]   # 備註', 'cpu: heavy # 重活', 'budget_usd: 1', 'status: todo', 'owner: 測試', 'must_catch: []']),
    );
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'LANDING V2 docs')).toBe(true);
  }, 60_000);

  it('Windows 換行(CRLF)的檔頭照樣合法', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/V3.md', fileText(base({ id: 'V3' }), '\r\n'));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'READY V3')).toBe(true);
  }, 60_000);

  it('欄位不合法與重複鍵、空值、清單括號:各印一行 invalid <欄位>(逐筆對照)', () => {
    const cases: { id: string; lines: string[]; problems: string[]; name?: string }[] = [
      { id: 'D1', lines: [...base({ id: 'D1' }), 'cpu: light'], problems: ['invalid cpu'] },
      { id: 'D2', lines: [...base({ id: 'D2' }), 'id: D2'], problems: ['invalid id'], name: 'D2.md' },
      { id: 'E1', lines: base({ id: 'E1', cpu: '', owner: '' }), problems: ['invalid cpu', 'invalid owner'] },
      { id: 'E2', lines: base({ id: 'E2', status: '' }), problems: ['invalid status'] },
      { id: 'B1', lines: base({ id: 'B1', budget_usd: '.5' }), problems: ['invalid budget_usd'] },
      { id: 'B2', lines: base({ id: 'B2', budget_usd: '1.' }), problems: ['invalid budget_usd'] },
      { id: 'B3', lines: base({ id: 'B3', budget_usd: '0' }), problems: ['invalid budget_usd'] },
      { id: 'B4', lines: base({ id: 'B4', budget_usd: '0.0' }), problems: ['invalid budget_usd'] },
      { id: 'B5', lines: base({ id: 'B5', budget_usd: '1e3' }), problems: ['invalid budget_usd'] },
      { id: 'B6', lines: base({ id: 'B6', budget_usd: '1,5' }), problems: ['invalid budget_usd'] },
      { id: 'B7', lines: base({ id: 'B7', budget_usd: '0', status: 'dropped' }), problems: [] },
      { id: 'B8', lines: base({ id: 'B8', budget_usd: '0', status: 'merged' }), problems: [] },
      { id: 'B9', lines: base({ id: 'B9', budget_usd: '1.5' }), problems: [] },
      { id: 'L1', lines: base({ id: 'L1', deps: '[T1' }), problems: ['invalid deps'] },
      { id: 'L2', lines: base({ id: 'L2', touches: 'docs/a/]' }), problems: ['invalid touches'] },
      { id: 'L3', lines: base({ id: 'L3', must_catch: '[a, "b"]' }), problems: ['invalid must_catch'] },
      { id: 'L4', lines: base({ id: 'L4', deps: '[[T1]]' }), problems: ['invalid deps'] },
      { id: 'L5', lines: base({ id: 'L5', deps: '{T1}' }), problems: ['invalid deps'] },
      { id: 'L6', lines: base({ id: 'L6', deps: "['T1']" }), problems: ['invalid deps'] },
      { id: 'S1', lines: base({ id: 'S1', status: '>todo' }), problems: ['invalid status'] },
      { id: 'S2', lines: base({ id: 'S2', owner: '|' }), problems: ['invalid owner'] },
      { id: 'S3', lines: base({ id: 'S3', cpu: '{light}' }), problems: ['invalid cpu'] },
      { id: 'S4', lines: base({ id: 'S4', cpu: '[light]' }), problems: ['invalid cpu'] },
    ];
    const root = p2Tree([]);
    for (const c of cases) P2.writeRaw(root, `docs/tickets/${c.id}.md`, fileText(c.lines));
    const r = checkOf(root);
    const expected = cases.flatMap((c) => c.problems.map((p) => `PROBLEM bad-header ${c.name ?? c.id} ${p}`));
    expect(linesStarting(r, 'PROBLEM').sort()).toEqual(expected.sort());
    // 合法的 todo(B9)讀得進來、READY;merged / dropped(B7、B8)讀得進來但不輪 READY
    expect(linesStarting(r, 'READY B9')).toEqual(['READY B9']);
    expect(linesStarting(r, 'READY B7')).toEqual([]);
    expect(linesStarting(r, 'READY B8')).toEqual([]);
  }, 60_000);

  it('一行清單裡的空項、空白與空括號:[ T1 ,, T2 ] 等於 [T1, T2];[ ] 是空清單(依賴都已 merged → READY,沒有 unresolved-ref)', () => {
    const root = p2Tree([T('T1', 'merged', 'docs/z/'), T('T2', 'merged', 'docs/y/')]);
    P2.writeRaw(root, 'docs/tickets/V4.md', fileText(base({ id: 'V4', deps: '[ T1 ,, T2 ]', touches: '[ ]' })));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'READY V4')).toBe(true);
    expect(linesStarting(r, 'LANDING V4')).toEqual([]);
  }, 60_000);

  it('沒有檔頭:第一行不是 ---(空行開頭、四個減號、完全沒有)都是 PROBLEM missing-header <檔名>', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/N1.md', '# 沒有檔頭\nid: N1\n');
    P2.writeRaw(root, 'docs/tickets/N2.md', `\n${fileText(base({ id: 'N2' }))}`);
    P2.writeRaw(root, 'docs/tickets/N3.md', fileText(base({ id: 'N3' })).replace('---', '----'));
    const r = checkOf(root);
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM missing-header N1.md', 'PROBLEM missing-header N2.md', 'PROBLEM missing-header N3.md']);
  }, 60_000);

  it('id 不合法:PROBLEM 用檔名當名字(bad-header <檔名> invalid id);9T、T-1 不合法,T2c_1、Z_ok 合法', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/Z-bad-a.md', fileText(base({ id: '9T' })));
    P2.writeRaw(root, 'docs/tickets/Z-bad-b.md', fileText(base({ id: 'T-1' })));
    P2.writeRaw(root, 'docs/tickets/Z-ok.md', fileText(base({ id: 'T2c_1' })));
    P2.writeRaw(root, 'docs/tickets/Z-ok2.md', fileText(base({ id: 'Z_ok', touches: '[scripts/a.ts]' })));
    const r = checkOf(root);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM bad-header Z-bad-a.md invalid id', 'PROBLEM bad-header Z-bad-b.md invalid id']);
    expect(hasLine(r, 'READY T2c_1')).toBe(true);
    expect(hasLine(r, 'READY Z_ok')).toBe(true);
  }, 60_000);

  it('欄位名要完全相符:Id: T9(大小寫不同)不算 id → PROBLEM missing id,名字用檔名', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/C1.md', fileText(['Id: C1', ...base({}).slice(1)]));
    const r = checkOf(root);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM bad-header C1.md missing id']);
  }, 60_000);

  it('多行清單中間的空行與 # 註解行不會把清單截斷:後面的項目照樣收進來(touches 的第二項 apps/desktop/ 也有 LANDING)', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/M2.md', fileText(['id: M2', 'deps: []', 'touches:', '  - docs/a/', '', '  # 這是註解', '  - apps/desktop/', 'cpu: light', 'budget_usd: 1', 'status: todo', 'owner: 統籌', 'must_catch: []']));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(linesStarting(r, 'LANDING M2')).toEqual(['LANDING M2 10-desktop-shell', 'LANDING M2 docs']);
  }, 60_000);

  it('多行清單後面接別的鍵:deps: 底下沒有項目 → 空清單,下一個鍵照常讀(不被當成清單項)', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets/M1.md', fileText(['id: M1', 'deps:', 'touches:', '  - docs/a/', 'cpu: light', 'budget_usd: 1', 'status: todo', 'owner: 統籌', 'must_catch: []']));
    const r = checkOf(root);
    expect(r.status, r.stdout).toBe(0);
    expect(hasLine(r, 'LANDING M1 docs')).toBe(true);
  }, 60_000);
});

describe('補測·存活者 4:工單之間的規則不只看 todo(狀態與狀態之間的邊界)', () => {
  it('LANDING 與 no-landing 只印 todo / dispatched / review;merged 與 dropped 不印(它們的 unresolved-ref 照報)', () => {
    const r = checkOf(
      p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/'), T('T3', 'review', 'scripts/a.ts'), T('T4', 'merged', 'packages/core/x.ts'), T('T5', 'dropped', 'contracts/')]),
    );
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 docs', 'LANDING T2 10-desktop-shell', 'LANDING T3 infra']);
  }, 60_000);

  it('READY / BLOCKED / START 只輪得到 todo:dispatched 與 review 的工單即使依賴沒滿足也不印 BLOCKED', () => {
    const r = report(p2Tree([T('T1', 'todo', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/', { deps: 'T1' }), T('T3', 'review', 'scripts/a.ts', { deps: 'T1' })]));
    expect(linesStarting(r, 'BLOCKED')).toEqual([]);
    expect(linesStarting(r, 'READY')).toEqual(['READY T1']);
  }, 60_000);
});

describe('補測·--orca 真的接得起來(把印出來的腳本交給 bash 跑,假 orca 回 JSON)', () => {
  it('T1 先建;T2 的 --deps 是 T1 建出來的 task id(照 jq 路徑 .result.task.id 取);不是字面的 $T1', () => {
    const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
    expect(jq.status, '這台沒有 jq,--orca 的腳本跑不了').toBe(0);
    const root = p2Tree([T('T2', 'todo', 'scripts/b.ts', { deps: 'T1' }), T('T1', 'todo', 'docs/a/')]);
    const script = P2.runDagCli(['--root', root, '--orca']).stdout;
    const base = mkTmp('dag-p2-orca-run');
    const bin = join(base, 'bin');
    const depsLog = join(base, 'deps.log');
    const counter = join(base, 'count');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'orca'),
      [
        '#!/bin/sh',
        `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'`,
        `while [ $# -gt 0 ]; do if [ "$1" = "--deps" ]; then printf '%s\\n' "$2" >> '${depsLog}'; fi; shift; done`,
        `printf '{"result":{"task":{"id":"task-%s"}}}\\n' "$n"`,
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(join(bin, 'orca'), 0o755);
    const run = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(depsLog, 'utf8').trim().split('\n')).toEqual(['[]', '["task-1"]']);
  }, 60_000);
});

describe('補測·存活者(第二批):前綴要在開頭、重活只擋重活、名字像整合點的工單', () => {
  it('touches 要從開頭對上前綴:vendor/docs/x.md 含有 docs/ 但不是 docs/ 底下 → no-landing', () => {
    const r = checkOf(p2Tree([T('T1', 'todo', 'vendor/docs/x.md')]));
    expect(r.status).toBe(1);
    expect(linesStarting(r, 'PROBLEM')).toEqual(['PROBLEM no-landing T1 vendor/docs/x.md']);
    expect(linesStarting(r, 'LANDING')).toEqual([]);
  }, 60_000);

  it('輕活不被重活擋:重活 dispatched 佔著,落點不同的輕活 todo → START,沒有 HELD', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'apps/desktop/', { cpu: 'heavy' }), T('T2', 'todo', 'docs/a/', { cpu: 'light' })]));
    expect(linesStarting(r, 'START')).toEqual(['START T2']);
    expect(linesStarting(r, 'HELD')).toEqual([]);
  }, 60_000);

  it('工單的 id 長得像整合點(I4x)時,它是工單:merged 就算滿足依賴它的工單(不去查 git tag)', () => {
    const r = report(p2Tree([T('I4x', 'merged', 'docs/a/'), T('T1', 'todo', 'apps/desktop/', { deps: 'I4x' })]));
    expect(hasLine(r, 'READY T1'), r.stdout).toBe(true);
    expect(linesStarting(r, 'BLOCKED')).toEqual([]);
    // R5 深度也一樣:merged 的 I4x 算 0,後面的鏈不被墊高(T6 只有深度 5)
    const chain = report(
      p2Tree([T('I4x', 'merged', 'docs/a/'), T('T2', 'todo', 'docs/b/', { deps: 'I4x' }), T('T3', 'todo', 'docs/c/', { deps: 'T2' }), T('T4', 'todo', 'docs/d/', { deps: 'T3' }), T('T5', 'todo', 'docs/e/', { deps: 'T4' }), T('T6', 'todo', 'docs/f/', { deps: 'T5' })]),
    );
    expect(linesStarting(chain, 'WARN')).toEqual(['WARN r5-depth T6 5']);
    const todo = report(p2Tree([T('I4x', 'todo', 'docs/a/'), T('T1', 'todo', 'apps/desktop/', { deps: 'I4x' })]));
    expect(linesStarting(todo, 'BLOCKED')).toEqual(['BLOCKED T1 by I4x']);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// phase-2 第二輪補測(T39 重測後仍存活的變異,docs/reviews/acceptance-T39-round2-survivors.md)。
// 只新增、不動上面任何一條斷言。全部走 CLI。每個 describe 以「補測2·」開頭,標了它對應清單的哪一類。
// ═══════════════════════════════════════════════════════════════════════════════════════
const RAW_OK = ['id: T1', 'deps: []', 'touches: [docs/a/]', 'cpu: light', 'budget_usd: 1', 'status: todo', 'owner: worker-grok', 'must_catch: []'];
const rawTicket = (root: string, file: string, text: string): void => P2.writeRaw(root, `docs/tickets/${file}`, text);
const problemsOf = (r: { stdout: string }): string[] => linesStarting(r, 'PROBLEM');
const features01 = (rows: [number, string][], next: string): { folder: string; rows: [number, string][]; next: string }[] => [{ folder: '01-alpha', rows, next }];

describe('補測2·檔頭開頭與收尾的 ---(parseHeaderText:首行、收尾、沒收尾)', () => {
  it('首行 --- 前後帶空白或 tab 仍算有檔頭(不出 missing-header)', () => {
    for (const open of ['--- ', '  ---', '\t---\t']) {
      const root = p2Tree([]);
      rawTicket(root, 'T1-x.md', `${open}\n${RAW_OK.join('\n')}\n---\n\n內文\n`);
      const r = checkOf(root);
      expect(r.status, `${JSON.stringify(open)}: ${r.stdout}`).toBe(0);
      expect(problemsOf(r)).toEqual([]);
      expect(hasLine(r, 'READY T1')).toBe(true);
    }
  }, 120_000);

  it('檔頭開了沒有收尾的 ---:一路讀到檔尾,欄位都算;不丟例外(退出碼 0,不是 2)', () => {
    for (const text of [`---\n${RAW_OK.join('\n')}\n`, `---\n${RAW_OK.join('\n')}`]) {
      const root = p2Tree([]);
      rawTicket(root, 'T1-x.md', text);
      const r = checkOf(root);
      expect(r.status, `${r.stderr}${r.stdout}`).toBe(0);
      expect(r.stderr).toBe('');
      expect(hasLine(r, 'READY T1')).toBe(true);
    }
  }, 120_000);

  it('收尾的 --- 後面帶空白也算收尾:底下內文裡長得像欄位的行(status: merged、id: T77)不併進檔頭', () => {
    for (const close of ['---   ', '  ---', '\t---']) {
      const root = p2Tree([]);
      rawTicket(root, 'T1-x.md', `---\n${RAW_OK.join('\n')}\n${close}\nstatus: merged\nid: T77\n`);
      const r = checkOf(root);
      expect(problemsOf(r), JSON.stringify(close)).toEqual([]);
      expect(hasLine(r, 'READY T1'), JSON.stringify(close)).toBe(true);
    }
  }, 120_000);

  it('檔頭中間的空行不是收尾:空行之後的欄位照樣算', () => {
    const root = p2Tree([]);
    const lines = [...RAW_OK.slice(0, 3), '', '   ', ...RAW_OK.slice(3)];
    rawTicket(root, 'T1-x.md', `---\n${lines.join('\n')}\n---\n`);
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual([]);
    expect(hasLine(r, 'READY T1')).toBe(true);
  }, 60_000);
});

describe('補測2·檔頭的 block 清單與行內雜訊(parseHeaderText:空白行、孤兒 - 項、縮排、自由文字)', () => {
  const blockDeps = (between: string[]): string[] => ['id: T1', 'deps:', '  - T2', ...between, '  - T3', ...RAW_OK.slice(2)];

  it('block 清單的兩個項目中間夾空白行或 # 註解行:清單不中斷,兩個項目都算', () => {
    for (const between of [['   '], ['\t'], ['# 備註'], ['   # 縮排的備註'], ['', '   ', '# x']]) {
      const root = p2Tree([T('T2', 'todo', 'docs/b/'), T('T3', 'todo', 'docs/c/')]);
      rawTicket(root, 'T1-x.md', `---\n${blockDeps(between).join('\n')}\n---\n`);
      const r = checkOf(root);
      expect(problemsOf(r), JSON.stringify(between)).toEqual([]);
      expect(linesStarting(r, 'BLOCKED T1'), JSON.stringify(between)).toEqual(['BLOCKED T1 by T2,T3']);
    }
  }, 300_000);

  it('不在清單裡的「- X」行(欄位 scalar 之後、檔頭一開始)被略過,不當成清單項、不丟例外', () => {
    for (const at of [1, 4, 6]) {
      const root = p2Tree([]);
      const lines = [...RAW_OK];
      lines.splice(at, 0, '- stray', '  - [ ] 孤兒項');
      rawTicket(root, 'T1-x.md', `---\n${lines.join('\n')}\n---\n`);
      const r = checkOf(root);
      expect(r.status, `${at}: ${r.stderr}${r.stdout}`).toBe(0);
      expect(hasLine(r, 'READY T1'), String(at)).toBe(true);
    }
  }, 180_000);

  it('清單項只屬於它上面那個 key:下一個 key 開始後,再出現的「- X」不併進前一個清單', () => {
    const root = p2Tree([T('T2', 'todo', 'docs/b/')]);
    const lines = ['id: T1', 'deps:', '  - T2', 'touches: [docs/a/]', '  - T9', ...RAW_OK.slice(3)];
    rawTicket(root, 'T1-x.md', `---\n${lines.join('\n')}\n---\n`);
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual([]);
    expect(linesStarting(r, 'LANDING T1')).toEqual(['LANDING T1 docs']);
    expect(linesStarting(r, 'BLOCKED T1')).toEqual(['BLOCKED T1 by T2']);
  }, 60_000);

  it('縮排的 key 行照常解析(空白或 tab 開頭)', () => {
    for (const indent of ['  ', '\t', '    ']) {
      const root = p2Tree([]);
      rawTicket(root, 'T1-x.md', `---\n${RAW_OK.map((l) => `${indent}${l}`).join('\n')}\n---\n`);
      const r = checkOf(root);
      expect(problemsOf(r), JSON.stringify(indent)).toEqual([]);
      expect(hasLine(r, 'READY T1'), JSON.stringify(indent)).toBe(true);
    }
  }, 120_000);

  it('冒號後面不留空格也行(id:T1、cpu:light);key 後面接的不是冒號的行(自由文字、id-note: x)被略過,不蓋掉真的欄位', () => {
    const root = p2Tree([]);
    const lines = ['id:T1', 'deps:[]', 'touches:[docs/a/]', 'cpu:light', 'budget_usd:1', 'status:todo', 'owner:worker-grok', 'must_catch:[]'];
    lines.push('note about id: T7', 'id-note: T8', 'status.old: merged', 'see cpu: heavy');
    rawTicket(root, 'T1-x.md', `---\n${lines.join('\n')}\n---\n`);
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual([]);
    expect(hasLine(r, 'READY T1')).toBe(true);
    expect(linesStarting(r, 'READY')).toEqual(['READY T1']);
  }, 60_000);

  it('budget_usd 的寫法:0.25、1.5、10 合法;1abc、.5、1.、1.2.3、-1、1e3 不合法(invalid budget_usd)', () => {
    for (const v of ['0.25', '1.5', '10', '0.5', '12.75']) {
      const root = p2Tree([]);
      putTicket(root, 'T1-x.md', { id: 'T1', budget_usd: v });
      expect(problemsOf(checkOf(root)), v).toEqual([]);
    }
    for (const v of ['1abc', '.5', '1.', '1.2.3', '-1', '1e3', 'abc']) {
      const root = p2Tree([]);
      putTicket(root, 'T1-x.md', { id: 'T1', budget_usd: v });
      expect(problemsOf(checkOf(root)), v).toEqual(['PROBLEM bad-header T1 invalid budget_usd']);
    }
  }, 300_000);

  it('PROBLEM 行的名字:id 缺漏、不合法時是檔名;兩個檔 id 重複(都合法)只出一行 duplicate-id', () => {
    const root = p2Tree([]);
    rawTicket(root, 'noid.md', `---\n${RAW_OK.filter((l) => !l.startsWith('id:')).join('\n')}\n---\n`);
    putTicket(root, 'bad-id.md', { id: '1bad' });
    putTicket(root, 'dup-a.md', { id: 'T3' });
    putTicket(root, 'dup-b.md', { id: 'T3' });
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual(['PROBLEM bad-header bad-id.md invalid id', 'PROBLEM bad-header noid.md missing id', 'PROBLEM duplicate-id T3']);
  }, 60_000);
});

describe('補測2·落點檔載入:壞檔與缺檔回空表,不能多出假的一列(touch 用大寫 S 開頭)', () => {
  const touch = 'Src/a.ts';
  const okRun = (root: string): { status: number | null; stdout: string; stderr: string } => checkOf(root);
  const expectEmptyTable = (r: { status: number | null; stdout: string; stderr: string }, label: string): void => {
    expect(r.status, `${label}: ${r.stderr}`).toBe(1);
    expect(problemsOf(r), label).toEqual([`PROBLEM no-landing T1 ${touch}`]);
    expect(linesStarting(r, 'LANDING'), label).toEqual([]);
  };

  it('缺檔、是目錄、JSON 壞掉、owners 不是陣列:都當空表,大寫 S 開頭的 touch 沒有落點', () => {
    const cases: [string, (root: string) => void][] = [
      ['缺檔', () => undefined],
      ['目錄', (root) => mkdirSync(join(root, 'scripts/boundaries.owners.json'), { recursive: true })],
      ['壞 JSON', (root) => P2.writeRaw(root, 'scripts/boundaries.owners.json', '{ "owners": [ ["Src/", "x"], ')],
      ['owners 是物件', (root) => P2.writeRaw(root, 'scripts/boundaries.owners.json', '{ "owners": { "Src/": "x" } }')],
      ['owners 是字串', (root) => P2.writeRaw(root, 'scripts/boundaries.owners.json', '{ "owners": "Src/" }')],
      ['沒有 owners 鍵', (root) => P2.writeRaw(root, 'scripts/boundaries.owners.json', '{}')],
      ['空檔', (root) => P2.writeRaw(root, 'scripts/boundaries.owners.json', '')],
    ];
    for (const [label, write] of cases) {
      const root = p2Tree([T('T1', 'todo', touch)], { landing: null });
      write(root);
      expectEmptyTable(okRun(root), label);
    }
  }, 600_000);

  it('正常載入:只有檔裡的列(沒有多出的假列);沒有前綴對得上的 touch 照樣 no-landing', () => {
    const root = p2Tree([T('T1', 'todo', `a/b.ts, ${touch}`)], { landing: [['a/', 'x']] });
    const r = okRun(root);
    expect(linesStarting(r, 'LANDING')).toEqual(['LANDING T1 x']);
    expect(problemsOf(r)).toEqual([`PROBLEM no-landing T1 ${touch}`]);
  }, 60_000);

  it('同長度的前綴(同一個前綴寫了兩列):先寫的贏', () => {
    for (const [rows, want] of [
      [[['docs/a/', 'first'], ['docs/a/', 'second']], 'first'],
      [[['docs/a/', 'second'], ['docs/a/', 'first']], 'second'],
    ] as [[string, string][], string][]) {
      const root = p2Tree([T('T1', 'todo', 'docs/a/x.md')], { landing: rows });
      expect(linesStarting(checkOf(root), 'LANDING'), want).toEqual([`LANDING T1 ${want}`]);
    }
  }, 120_000);
});

describe('補測2·infra 重疊:b 不是目錄時,a 以 b 開頭不算共用(infraShared 兩個方向)', () => {
  const pair = (a: string, b: string): string[] => problemsOf(checkOf(p2Tree([T('T1', 'dispatched', a), T('T2', 'dispatched', b)])));

  it('scripts/a.ts.bak 對 scripts/a.ts(兩個順序):不重疊;對真的目錄 scripts/ 才重疊', () => {
    expect(pair('scripts/a.ts.bak', 'scripts/a.ts')).toEqual([]);
    expect(pair('scripts/a.ts', 'scripts/a.ts.bak')).toEqual([]);
    expect(pair('scripts/a.ts.bak', 'scripts/')).toEqual(['PROBLEM r2-overlap T1 T2 on infra:scripts/']);
    expect(pair('scripts/', 'scripts/a.ts.bak')).toEqual(['PROBLEM r2-overlap T1 T2 on infra:scripts/']);
  }, 120_000);
});

describe('補測2·phase 形式的依賴(classifyDep / wireDeps):解析、滿足、解不開', () => {
  const FEATS = features01([[1, 'done'], [2, 'todo'], [3, 'in-progress'], [4, 'blocked']], `${NO_GATE(1)}${NO_GATE(2)}${NO_GATE(3)}${NO_GATE(4)}`);
  const withDep = (dep: string, extra: Row[] = []): ReturnType<typeof report> => report(p2Tree([T('T1', 'todo', 'docs/a/', { deps: dep }), ...extra], { features: FEATS }));

  it('資料夾/phase 寫法與「01 phase-1」寫法:phase 已 done → READY,邊畫出來', () => {
    for (const dep of ['01-alpha/phase-1', '01 phase-1', '01-alpha phase-1']) {
      const r = withDep(dep);
      expect(hasLine(r, 'READY T1'), dep).toBe(true);
      expect(linesStarting(r, 'BLOCKED T1'), dep).toEqual([]);
      expect(problemsOf(r).filter((l) => l.includes('unresolved-ref')), dep).toEqual([]);
      expect(edgeLines(r), dep).toContain('    "01-alpha/phase-1" --> "T1"');
    }
  }, 180_000);

  it('phase 的狀態不是 done(todo、in-progress、blocked)都不算滿足:BLOCKED,不 READY', () => {
    for (const n of [2, 3, 4]) {
      const r = withDep(`01-alpha/phase-${n}`);
      expect(linesStarting(r, 'BLOCKED T1'), String(n)).toEqual([`BLOCKED T1 by 01-alpha/phase-${n}`]);
      expect(linesStarting(r, 'READY T1'), String(n)).toEqual([]);
      expect(linesStarting(r, 'START T1'), String(n)).toEqual([]);
    }
  }, 180_000);

  it('資料夾不存在、phase 不存在:PROBLEM unresolved-ref,而且不出 BLOCKED / READY', () => {
    for (const dep of ['99-nope/phase-1', '01-alpha/phase-9', '99 phase-1']) {
      const r = withDep(dep);
      expect(problemsOf(r), dep).toEqual([`PROBLEM unresolved-ref T1 ${dep}`]);
      expect(linesStarting(r, 'BLOCKED T1'), dep).toEqual([]);
      expect(linesStarting(r, 'READY T1'), dep).toEqual([]);
    }
  }, 180_000);

  it('不是 phase 形式的字串(單獨 phase-1、ADR-040、一般句子、句子裡夾一個 phase 參照)一律 unresolved-ref', () => {
    for (const dep of ['phase-1', 'ADR-040', 'nonsense', 'after 01-alpha/phase-1', '01-alpha/phase-1 done']) {
      const r = withDep(dep);
      expect(problemsOf(r), dep).toEqual([`PROBLEM unresolved-ref T1 ${dep}`]);
      expect(linesStarting(r, 'READY T1'), dep).toEqual([]);
    }
  }, 180_000);

  it('單獨 phase-1 沒有資料夾,即使有個資料夾叫 null-x 也不能對上', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'phase-1' })], { features: [{ folder: 'null-x', rows: [[1, 'done']], next: NO_GATE(1) }] });
    const r = report(root);
    expect(problemsOf(r)).toEqual(['PROBLEM unresolved-ref T1 phase-1']);
    expect(linesStarting(r, 'READY T1')).toEqual([]);
  }, 60_000);

  it('同一個 phase 在表裡出現兩次:先出現的那列為準(第一列 done → 滿足;第一列 todo → 不滿足)', () => {
    const doneFirst = report(p2Tree([T('T1', 'todo', 'docs/a/', { deps: '01-alpha/phase-1' })], { features: features01([[1, 'done'], [1, 'todo']], NO_GATE(1)) }));
    expect(hasLine(doneFirst, 'READY T1')).toBe(true);
    const todoFirst = report(p2Tree([T('T1', 'todo', 'docs/a/', { deps: '01-alpha/phase-1' })], { features: features01([[1, 'todo'], [1, 'done']], NO_GATE(1)) }));
    expect(linesStarting(todoFirst, 'BLOCKED T1')).toEqual(['BLOCKED T1 by 01-alpha/phase-1']);
  }, 120_000);
});

describe('補測2·docs/tickets 底下的雜物(loadTicketNodes:不是目錄、非 .md、名叫 x.md 的目錄)', () => {
  it('docs/tickets 是一般檔案:當作沒有工單,不丟例外(退出碼 0)', () => {
    const root = p2Tree([]);
    P2.writeRaw(root, 'docs/tickets', 'not a directory\n');
    const r = checkOf(root);
    expect(r.status, `${r.stderr}${r.stdout}`).toBe(0);
    expect(linesStarting(r, 'READY')).toEqual([]);
    expect(problemsOf(r)).toEqual([]);
  }, 60_000);

  it('非 .md 的檔(notes.txt、.gitkeep、T1.md.bak)被忽略,不出 missing-header', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/')]);
    for (const f of ['notes.txt', '.gitkeep', 'T1-example.md.bak', 'README']) rawTicket(root, f, '隨手記,沒有檔頭\n');
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual([]);
    expect(linesStarting(r, 'READY')).toEqual(['READY T1']);
  }, 60_000);

  it('名叫 x.md 的目錄被略過,不丟例外', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/')]);
    mkdirSync(join(root, 'docs/tickets/dir.md'), { recursive: true });
    P2.writeRaw(root, 'docs/tickets/dir.md/inner.md', '---\nid: T5\n---\n');
    const r = checkOf(root);
    expect(r.status, `${r.stderr}${r.stdout}`).toBe(0);
    expect(problemsOf(r)).toEqual([]);
    expect(linesStarting(r, 'READY')).toEqual(['READY T1']);
  }, 60_000);
});

describe('補測2·整合點閘門與名字像閘門的工單(wireDeps / augment 的 satisfied)', () => {
  it('名叫 XI4 的工單 merged:依賴它的工單不被擋(不被當成沒 tag 的整合點)', () => {
    const r = report(p2Tree([T('XI4', 'merged', 'docs/b/'), T('T1', 'todo', 'docs/a/', { deps: 'XI4' })]));
    expect(hasLine(r, 'READY T1')).toBe(true);
    expect(linesStarting(r, 'BLOCKED T1')).toEqual([]);
  }, 60_000);

  it('整合點 I10:有 tag I10 → 滿足;只有 tag I1 → 不滿足(BLOCKED T1 by I10)', () => {
    const has = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I10' })]);
    gitInit(has, ['I10']);
    expect(hasLine(report(has), 'READY T1')).toBe(true);
    const lacks = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'I10' })]);
    gitInit(lacks, ['I1']);
    expect(linesStarting(report(lacks), 'BLOCKED T1')).toEqual(['BLOCKED T1 by I10']);
  }, 120_000);

  const chain5 = (last: string): Row[] => [1, 2, 3, 4].map((n) => T(`A${n}`, 'todo', 'docs/a/', { deps: `A${n + 1}` })).concat(T('A5', 'todo', 'docs/a/', { deps: last }));

  it('R5 深度:鏈尾依賴 merged 的 XI4 → XI4 算 0,A1 深度 5(只印 A1)', () => {
    const r = report(p2Tree([...chain5('XI4'), T('XI4', 'merged', 'docs/b/')]));
    expect(linesStarting(r, 'WARN r5-depth')).toEqual(['WARN r5-depth A1 5']);
  }, 60_000);

  it('R5 深度:鏈尾依賴有 tag 的 I10 → I10 算 0,A1 深度 5(只印 A1);沒有 tag 時 A1 是 6、A2 是 5', () => {
    const tagged = p2Tree(chain5('I10'));
    gitInit(tagged, ['I10']);
    expect(linesStarting(report(tagged), 'WARN r5-depth')).toEqual(['WARN r5-depth A1 5']);
    const untagged = p2Tree(chain5('I10'));
    gitInit(untagged, []);
    expect(linesStarting(report(untagged), 'WARN r5-depth')).toEqual(['WARN r5-depth A1 6', 'WARN r5-depth A2 5']);
  }, 120_000);

  it('R5 深度:沒做完的 phase 要算進去(phase-1、phase-2 都 todo,鏈尾工單依賴 phase-2 → A1 深度 6、A2 深度 5)', () => {
    const features = features01([[1, 'todo'], [2, 'todo']], `${NO_GATE(1)}${NEEDS(2, 'phase-1 `done`')}`);
    const rows = [1, 2, 3].map((n) => T(`A${n}`, 'todo', 'docs/a/', { deps: `A${n + 1}` })).concat(T('A4', 'todo', 'docs/a/', { deps: '01-alpha/phase-2' }));
    const r = report(p2Tree(rows, { features }));
    expect(linesStarting(r, 'WARN r5-depth')).toEqual(['WARN r5-depth A1 6', 'WARN r5-depth A2 5']);
  }, 60_000);

  it('R5 深度沿 phase 邊走:同一個資料夾 phase-1 ← phase-2 ← … ← phase-6 都沒做完 → phase-5 深度 5、phase-6 深度 6;方向不可反', () => {
    const next = `${NO_GATE(1)}${[2, 3, 4, 5, 6].map((n) => NEEDS(n, `phase-${n - 1} \`done\``)).join('')}`;
    const r = report(p2Tree([], { features: features01([[1, 'todo'], [2, 'todo'], [3, 'todo'], [4, 'todo'], [5, 'todo'], [6, 'todo']], next) }));
    expect(linesStarting(r, 'WARN r5-depth')).toEqual(['WARN r5-depth 01-alpha/phase-5 5', 'WARN r5-depth 01-alpha/phase-6 6']);
  }, 60_000);

  it('R5 深度沿 phase 邊走(其二):phase 鏈上已 done 的前半不算;in-progress 的算', () => {
    const next = `${NO_GATE(1)}${[2, 3, 4, 5, 6].map((n) => NEEDS(n, `phase-${n - 1} \`done\``)).join('')}`;
    const r = report(p2Tree([], { features: features01([[1, 'done'], [2, 'done'], [3, 'in-progress'], [4, 'todo'], [5, 'todo'], [6, 'todo']], next) }));
    expect(linesStarting(r, 'WARN r5-depth')).toEqual([]);
    const r2 = report(p2Tree([], { features: features01([[1, 'done'], [2, 'in-progress'], [3, 'todo'], [4, 'todo'], [5, 'todo'], [6, 'todo']], next) }));
    expect(linesStarting(r2, 'WARN r5-depth')).toEqual(['WARN r5-depth 01-alpha/phase-6 5']);
  }, 120_000);
});

describe('補測2·環(findCycles 之後的接線:環上的工單不 READY、不 START)', () => {
  it('兩張互相依賴,一張已 merged、一張 todo(todo 沒有 unmet):環上的 todo 不 READY、不 START、不 BLOCKED;兩個方向都測', () => {
    for (const [first, second] of [['merged', 'todo'], ['todo', 'merged']]) {
      const root = p2Tree([T('T1', first!, 'docs/a/', { deps: 'T2' }), T('T2', second!, 'docs/b/', { deps: 'T1' })]);
      const r = checkOf(root);
      expect(problemsOf(r), `${first}/${second}`).toEqual(['PROBLEM cycle T1 -> T2 -> T1']);
      expect(linesStarting(r, 'READY'), `${first}/${second}`).toEqual([]);
      expect(linesStarting(r, 'START'), `${first}/${second}`).toEqual([]);
      expect(linesStarting(r, 'BLOCKED'), `${first}/${second}`).toEqual([]);
    }
  }, 120_000);

  it('三張的環,環上有兩張 todo、其中一張的依賴都滿足:滿足的那張(不論在環上第幾個)不 READY', () => {
    const root = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'T3' }), T('T2', 'merged', 'docs/b/', { deps: 'T1' }), T('T3', 'todo', 'docs/c/', { deps: 'T2' })]);
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual(['PROBLEM cycle T1 -> T3 -> T2 -> T1']);
    expect(linesStarting(r, 'READY')).toEqual([]);
    expect(linesStarting(r, 'START')).toEqual([]);
  }, 60_000);

  it('環上還有一個依賴(phase):todo 工單依賴「別張工單加一個 phase」,與別張成環,環照樣被偵測', () => {
    const features = features01([[1, 'todo']], NO_GATE(1));
    const root = p2Tree([T('T1', 'todo', 'docs/a/', { deps: 'T2, 01-alpha/phase-1' }), T('T2', 'todo', 'docs/b/', { deps: 'T1' })], { features });
    const r = checkOf(root);
    expect(r.status, `${r.stderr}${r.stdout}`).toBe(1);
    expect(problemsOf(r)).toEqual(['PROBLEM cycle T1 -> T2 -> T1']);
    expect(linesStarting(r, 'READY T')).toEqual([]);
  }, 60_000);
});

describe('補測2·只有一條規則擋住時仍是 HELD、不 START(R2、R3、R4 各自單獨)', () => {
  it('只有 R3(兩張重活,落點不相交):HELD by R3,沒有 R2 / R4 行,也沒有 START', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'apps/desktop/', { cpu: 'heavy' }), T('T2', 'todo', 'docs/a/', { cpu: 'heavy' })]));
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T2 by R3 with T1']);
    expect(linesStarting(r, 'START')).toEqual([]);
  }, 60_000);

  it('只有 R2(落點相交,都是輕活):HELD by R2,沒有 START', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'todo', 'docs/a/')]));
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T2 by R2 with T1']);
    expect(linesStarting(r, 'START')).toEqual([]);
  }, 60_000);

  it('只有 R4(已經 3 張 dispatched、落點都不相交,輕活):HELD by R4,沒有 START', () => {
    const r = report(p2Tree([T('T1', 'dispatched', 'docs/a/'), T('T2', 'dispatched', 'apps/desktop/'), T('T3', 'dispatched', 'packages/core/src/scheduler/'), T('T4', 'todo', 'packages/x/')]));
    expect(linesStarting(r, 'HELD')).toEqual(['HELD T4 by R4 with T1,T2,T3']);
    expect(linesStarting(r, 'START')).toEqual([]);
  }, 60_000);
});

describe('補測2·phase 的 START / HELD 只對 READY 的 phase 發', () => {
  const MIX = [
    { folder: '01-alpha', rows: [[1, 'todo'], [2, 'todo']] as [number, string][], next: `${NO_GATE(1)}${NEEDS(2, 'phase-1 `done`')}` },
    { folder: '02-beta', rows: [[1, 'done'], [2, 'blocked']] as [number, string][], next: `${NO_GATE(1)}${NEEDS(2, 'phase-1 `done`')}` },
    { folder: '03-gamma', rows: [[1, 'done'], [2, 'todo']] as [number, string][], next: `${NO_GATE(1)}${NEEDS(2, 'phase-1 `done`、ADR-040 已決定')}` },
  ];

  it('READY 的 phase 才有 START;BLOCKED、blocked、done、HUMAN 的 phase 都不發 START', () => {
    const r = report(p2Tree([], { features: MIX }));
    expect(linesStarting(r, 'READY')).toEqual(['READY 01-alpha/phase-1']);
    expect(linesStarting(r, 'BLOCKED').map((l) => l.split(' ')[1])).toEqual(['01-alpha/phase-2', '02-beta/phase-2']);
    expect(linesStarting(r, 'HUMAN').map((l) => l.split(' ')[1])).toEqual(['03-gamma/phase-2']);
    expect(linesStarting(r, 'START')).toEqual(['START 01-alpha/phase-1']);
    expect(linesStarting(r, 'HELD')).toEqual([]);
  }, 60_000);

  it('已有兩個 phase 在跑(in-progress):只有 READY 的 phase 發 HELD by R4,其餘不發', () => {
    const feats = [
      ...MIX,
      { folder: '04-delta', rows: [[1, 'in-progress'], [2, 'in-progress']] as [number, string][], next: `${NO_GATE(1)}${NO_GATE(2)}` },
    ];
    const r = report(p2Tree([], { features: feats }));
    expect(linesStarting(r, 'HELD')).toEqual(['HELD 01-alpha/phase-1 by R4 with 04-delta/phase-1,04-delta/phase-2']);
    expect(linesStarting(r, 'START')).toEqual([]);
  }, 60_000);

  it('摘要行的 human= 是 HUMAN 行的條數', () => {
    const r = report(p2Tree([], { features: MIX }));
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('gate=dag result=OK ready=1 blocked=2 human=1 problems=0');
  }, 60_000);
});

describe('補測2·PROBLEM 行排序:同一張工單的欄位照欄位表順序,missing 在 invalid 前(compareRecord)', () => {
  it('同一張工單 cpu 與 budget_usd 同時不合法:cpu 在前(欄位表順序,不是字母序)', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-x.md', { id: 'T1', cpu: 'medium', budget_usd: 'abc' });
    expect(problemsOf(checkOf(root))).toEqual(['PROBLEM bad-header T1 invalid cpu', 'PROBLEM bad-header T1 invalid budget_usd']);
  }, 60_000);

  it('八個欄位都有問題:輸出順序就是欄位表 id、deps、touches、cpu、budget_usd、status、owner、must_catch', () => {
    const root = p2Tree([]);
    putTicket(root, 'T1-x.md', { id: '1bad', deps: 'x', touches: '[a, "b"]', cpu: 'medium', budget_usd: 'abc', status: 'maybe', owner: 'nobody', must_catch: '{x}' });
    expect(problemsOf(checkOf(root))).toEqual(['id', 'deps', 'touches', 'cpu', 'budget_usd', 'status', 'owner', 'must_catch'].map((f) => `PROBLEM bad-header 1bad-x.md invalid ${f}`).map((l) => l.replace('1bad-x.md', 'T1-x.md')));
  }, 60_000);

  it('兩個檔共用同一個名字(T5):缺 cpu 的在前、cpu 不合法的在後,不管檔案順序;T5 在 T10 之前', () => {
    const root = p2Tree([]);
    // T5:invalid 的檔排在前面;T6:missing 的檔排在前面 —— 兩種輸入順序都要得到 missing 在前
    putTicket(root, 'a1-t5-invalid.md', { id: 'T5', cpu: 'medium' });
    putTicket(root, 'a2-t5-missing.md', { id: 'T5', cpu: undefined });
    putTicket(root, 'a3-t6-missing.md', { id: 'T6', cpu: undefined });
    putTicket(root, 'a4-t6-invalid.md', { id: 'T6', cpu: 'medium' });
    putTicket(root, 'a0-t10.md', { id: 'T10', cpu: 'medium', status: undefined });
    const r = checkOf(root);
    expect(problemsOf(r)).toEqual([
      'PROBLEM bad-header T5 missing cpu',
      'PROBLEM bad-header T5 invalid cpu',
      'PROBLEM bad-header T6 missing cpu',
      'PROBLEM bad-header T6 invalid cpu',
      'PROBLEM bad-header T10 invalid cpu',
      'PROBLEM bad-header T10 missing status',
    ]);
  }, 60_000);

  it('檔名帶空白(id 缺漏時名字就是檔名):不被當成「名字 missing 欄位」拆開,照一般字串自然排序', () => {
    const root = p2Tree([]);
    const noId = RAW_OK.filter((l) => !l.startsWith('id:'));
    rawTicket(root, 'a missing x.md', `---\n${noId.join('\n')}\n---\n`);
    rawTicket(root, 'a invalid x.md', `---\n${noId.join('\n')}\n---\n`);
    expect(problemsOf(checkOf(root))).toEqual(['PROBLEM bad-header a invalid x.md missing id', 'PROBLEM bad-header a missing x.md missing id']);
  }, 60_000);
});

describe('補測2·READY / BLOCKED / START / HELD 同類行依 id 自然排序(T2 在 T10 前),PROBLEM 之外的類別不走 compareRecord', () => {
  it('檔名順序與 id 順序相反:每一類都是 T2 在 T10 前', () => {
    const root = p2Tree([]);
    putTicket(root, 'a-T10.md', { id: 'T10', touches: '[docs/j/]' });
    putTicket(root, 'b-T2.md', { id: 'T2', touches: '[apps/desktop/]' });
    putTicket(root, 'c-T11.md', { id: 'T11', deps: '[T10, T12]', touches: '[docs/k/]' });
    putTicket(root, 'd-T3.md', { id: 'T3', deps: '[T10, T12]', touches: '[docs/l/]' });
    putTicket(root, 'e-T12.md', { id: 'T12', status: 'dispatched', touches: '[packages/c/]' });
    const r = report(root);
    expect(linesStarting(r, 'READY')).toEqual(['READY T2', 'READY T10']);
    expect(linesStarting(r, 'BLOCKED')).toEqual(['BLOCKED T3 by T10,T12', 'BLOCKED T11 by T10,T12']);
    expect(linesStarting(r, 'START')).toEqual(['START T2', 'START T10']);
  }, 60_000);
});

describe('補測2·--orca 的鏈順序(Kahn 分層:id 小的可以依賴 id 大的)', () => {
  const orcaIds = (tickets: Row[]): string[] => P2.runDagCli(['--root', p2Tree(tickets), '--orca']).stdout.split('\n').filter(P2.isTaskLine).map((l) => l.split('=')[0]!);
  const orcaText = (tickets: Row[]): string => P2.runDagCli(['--root', p2Tree(tickets), '--orca']).stdout;
  const file = (id: string): string => P2.ticketFileName(id);

  it('T2 依賴 T10:T10 先建,T2 的 --deps 是 $T10', () => {
    const text = orcaText([T('T2', 'todo', 'docs/a/', { deps: 'T10' }), T('T10', 'todo', 'docs/b/')]);
    expect(text).toBe(`${P2.orcaLine('T10', file('T10'), [])}\n${P2.orcaLine('T2', file('T2'), ['T10'])}\n`);
  }, 60_000);

  it('菱形:兩個依賴都建好才輪到它(T3 依賴 T1 與 T2,T2 依賴 T10);同層自然排序', () => {
    const ids = orcaIds([
      T('T3', 'todo', 'docs/c/', { deps: 'T1, T2' }),
      T('T2', 'todo', 'docs/b/', { deps: 'T10' }),
      T('T1', 'todo', 'docs/a/'),
      T('T10', 'todo', 'docs/d/'),
    ]);
    expect(ids).toEqual(['T1', 'T10', 'T2', 'T3']);
    const text = orcaText([T('T3', 'todo', 'docs/c/', { deps: 'T1, T2' }), T('T2', 'todo', 'docs/b/', { deps: 'T10' }), T('T1', 'todo', 'docs/a/'), T('T10', 'todo', 'docs/d/')]);
    expect(text.split('\n')).toContain(P2.orcaLine('T3', file('T3'), ['T1', 'T2']));
    expect(text.split('\n')).toContain(P2.orcaLine('T2', file('T2'), ['T10']));
  }, 120_000);

  it('一張被好幾張依賴、也依賴好幾張:每一張只建一次、整串合乎拓樸序', () => {
    const rows = [
      T('T7', 'todo', 'docs/a/', { deps: 'T20, T9' }),
      T('T9', 'todo', 'docs/b/', { deps: 'T20' }),
      T('T20', 'todo', 'docs/c/'),
      T('T4', 'todo', 'docs/d/', { deps: 'T7, T9' }),
    ];
    const ids = orcaIds(rows);
    expect(ids).toEqual(['T20', 'T9', 'T7', 'T4']);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);

  it('自己依賴自己的工單:--deps 是 [](自環已是 PROBLEM cycle,但 --orca 不把自己列進自己的依賴)', () => {
    const text = orcaText([T('T1', 'todo', 'docs/a/', { deps: 'T1' })]);
    expect(text).toBe(`${P2.orcaLine('T1', file('T1'), [])}\n`);
  }, 60_000);

  it('環上的工單接在最後依自然排序;沒有 todo 時輸出空字串(不是一個換行)', () => {
    const ids = orcaIds([T('T8', 'todo', 'docs/a/', { deps: 'T7' }), T('T7', 'todo', 'docs/b/', { deps: 'T8' }), T('T9', 'todo', 'docs/c/'), T('T10', 'todo', 'docs/d/', { deps: 'T9' })]);
    expect(ids).toEqual(['T9', 'T10', 'T7', 'T8']);
    expect(orcaText([T('T1', 'merged', 'docs/a/')])).toBe('');
    expect(orcaText([])).toBe('');
  }, 120_000);

  it('真的交給 bash 跑:T2 依賴 T10 → 先建 T10;T2 的 --deps 是 T10 建出來的 task id', () => {
    const jq = spawnSync('jq', ['--version'], { encoding: 'utf8' });
    expect(jq.status, '這台沒有 jq,--orca 的腳本跑不了').toBe(0);
    const root = p2Tree([T('T2', 'todo', 'docs/a/', { deps: 'T10' }), T('T10', 'todo', 'docs/b/')]);
    const script = P2.runDagCli(['--root', root, '--orca']).stdout;
    const base = mkTmp('dag-p2-orca-run2');
    const bin = join(base, 'bin');
    const depsLog = join(base, 'deps.log');
    const counter = join(base, 'count');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'orca'),
      [
        '#!/bin/sh',
        `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'`,
        `while [ $# -gt 0 ]; do if [ "$1" = "--deps" ]; then printf '%s\\n' "$2" >> '${depsLog}'; fi; shift; done`,
        `printf '{"result":{"task":{"id":"task-%s"}}}\\n' "$n"`,
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(join(bin, 'orca'), 0o755);
    const run = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(depsLog, 'utf8').trim().split('\n')).toEqual(['[]', '["task-1"]']);
  }, 60_000);
});
