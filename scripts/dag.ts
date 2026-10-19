/**
 * 13-work-dag phase-1:從 FEATURE.md 的 Phase 表、NEXT.md 的 gate、git tag `I<N>`
 * 算出 READY / BLOCKED / HUMAN / PROBLEM 與 mermaid。只讀、只印、可重現。
 *
 * PROBLEM 種類(phase-1):
 *   - cycle            依賴成環(箭頭 = 需要)
 *   - unresolved-ref   gate 參照解不到 phase
 *   - no-phase-table   資料夾沒有 Phase 表(或沒有 FEATURE.md)
 *   - gate-not-declared  todo / ready 的 phase 完全沒寫 gate,不猜它能開工
 *
 * 沒有 --check:有 PROBLEM 也是退出碼 0。用法錯誤才是 2。
 *
 * 逐行 `- 項目` 的讀法(dashItemText)不把行首反引號當語法、不把行內 # 當註解,
 * 給 phase-2 讀工單檔頭時重用。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export type Status = 'todo' | 'ready' | 'in-progress' | 'done' | 'blocked' | string;

export type GateRef =
  | { kind: 'phase'; raw: string; folder: string | null; num: number }
  | { kind: 'integration'; name: string }
  | { kind: 'decision'; ref: string };

export interface Analysis {
  lines: string[];
  edges: [string, string][];
  counts: { ready: number; blocked: number; human: number; problems: number };
}

export interface TreeInput {
  folders: { name: string; featureMd: string | null; nextMd: string | null }[];
  tags: string[];
}

const KNOWN_STATUSES = ['in-progress', 'blocked', 'ready', 'todo', 'done'] as const;

// ───────────────────────────────────────────────────────────────── 自然排序

interface Token {
  num: boolean;
  text: string;
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  for (const text of s.match(/\d+|\D+/g) ?? []) out.push({ num: text[0]! >= '0' && text[0]! <= '9', text });
  return out;
}

/** 去前導零後按長度再按碼位比,不經 Number(長過 2^53 也要對)。 */
function compareDigits(a: string, b: string): number {
  const aa = a.replace(/^0+/, '') || '0';
  const bb = b.replace(/^0+/, '') || '0';
  if (aa.length !== bb.length) return aa.length < bb.length ? -1 : 1;
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

/** 自然排序:數字段按數值(任意長度),其餘按碼位;數值相同但寫法不同再以原字串碼位決定,全序。 */
export function compareNatural(a: string, b: string): number {
  if (a === b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const xa = ta[i]!;
    const xb = tb[i]!;
    if (xa.num && xb.num) {
      const cmp = compareDigits(xa.text, xb.text);
      if (cmp !== 0) return cmp;
      if (xa.text !== xb.text) return xa.text < xb.text ? -1 : 1;
      continue;
    }
    if (xa.text < xb.text) return -1;
    if (xa.text > xb.text) return 1;
  }
  return ta.length < tb.length ? -1 : ta.length > tb.length ? 1 : 0;
}

function sortNatural(values: string[]): string[] {
  return [...values].sort(compareNatural);
}

function uniqueSorted(values: string[]): string[] {
  return sortNatural([...new Set(values)]);
}

// ───────────────────────────────────────────────────────────────── Phase 表

function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const parts = t.split('|');
  if (parts.length < 3) return null;
  return parts.slice(1, -1).map((c) => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function normalizeStatus(raw: string): string {
  const s = raw.trim();
  for (const k of KNOWN_STATUSES) {
    if (s === k) return k;
    if (s.startsWith(k) && !/^[A-Za-z-]/.test(s.slice(k.length))) return k;
  }
  return s;
}

interface PhaseTable {
  rows: { phase: number; status: Status }[];
}

/** 有「Phase」與「狀態」兩欄的那張表;沒有回 null(有表頭沒資料列則 rows 為空)。 */
function findPhaseTable(featureMd: string): PhaseTable | null {
  const lines = featureMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = splitRow(lines[i]!);
    if (!header) continue;
    const phaseCol = header.indexOf('Phase');
    const statusCol = header.indexOf('狀態');
    if (phaseCol < 0 || statusCol < 0) continue;
    const rows: { phase: number; status: Status }[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const cells = splitRow(lines[j]!);
      if (!cells) break;
      if (isSeparator(cells)) continue;
      const phaseCell = cells[phaseCol] ?? '';
      if (!/^\d+$/.test(phaseCell)) continue;
      const statusCell = cells[statusCol] ?? '';
      rows.push({ phase: Number(phaseCell), status: normalizeStatus(statusCell) });
    }
    return { rows };
  }
  return null;
}

/** 讀 Phase 表,依檔案順序。沒有這種表回 []。狀態取開頭關鍵字;不認得的原樣。 */
export function parsePhaseTable(featureMd: string): { phase: number; status: Status }[] {
  return findPhaseTable(featureMd)?.rows ?? [];
}

// ───────────────────────────────────────────────────────────────── gate 參照

/**
 * 依出現順序、左到右、較長的寫法優先:
 *   slash   <name>/phase-N
 *   and     <name> phase-A 與 phase-B(同一個資料夾的兩條,現有 NEXT.md 的 shorthand)
 *   spaced  <name> phase-N 或 <name> phase-A/B(name 可以是兩位前綴,也可以是資料夾全名)
 *   bare    phase-N
 *   I / ADR / § / hex
 */
const REF_RE = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9_])(?<slashF>[A-Za-z0-9][A-Za-z0-9-]*)\/phase-(?<slashN>\d+)(?![A-Za-z0-9_-])`,
    String.raw`(?<![A-Za-z0-9_])(?<andF>[A-Za-z0-9][A-Za-z0-9-]*)[ \t]+phase-(?<andA>\d+)[ \t]*與[ \t]*phase-(?<andB>\d+)(?![A-Za-z0-9_-])`,
    String.raw`(?<![A-Za-z0-9_])(?<spF>[A-Za-z0-9][A-Za-z0-9-]*)[ \t]+phase-(?<spA>\d+)(?:\/(?<spB>\d+))?(?![A-Za-z0-9_-])`,
    String.raw`(?<![A-Za-z0-9_/])phase-(?<bareN>\d+)(?![A-Za-z0-9_-])`,
    String.raw`(?<![A-Za-z0-9_])I(?<iN>\d+)(?![A-Za-z0-9_-])`,
    String.raw`(?<![A-Za-z0-9_])ADR-(?<adrN>\d+)(?![A-Za-z0-9_])`,
    String.raw`§(?<sec>\d+[a-z]?)(?![A-Za-z0-9_])`,
    String.raw`(?<![A-Za-z0-9])(?<hex>[0-9a-fA-F]{7,})(?![A-Za-z0-9])`,
  ].join('|'),
  'g',
);

function phaseRef(raw: string, folder: string, num: string): GateRef {
  return { kind: 'phase', raw, folder, num: Number(num) };
}

function mixedHex(s: string): boolean {
  return /[0-9]/.test(s) && /[a-f]/i.test(s);
}

/**
 * 從一段 gate 文字依出現順序抽出參照。
 * 不剝反引號,不把 `#` 當註解(phase-2 的清單項目會含這兩樣)。
 */
export function parseGateRefs(text: string): GateRef[] {
  const out: GateRef[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const g = m.groups ?? {};
    if (g.slashF !== undefined) {
      out.push(phaseRef(`${g.slashF}/phase-${g.slashN}`, g.slashF, g.slashN!));
    } else if (g.andF !== undefined) {
      out.push(phaseRef(`${g.andF} phase-${g.andA}`, g.andF, g.andA!));
      out.push(phaseRef(`${g.andF} phase-${g.andB}`, g.andF, g.andB!));
    } else if (g.spF !== undefined) {
      out.push(phaseRef(`${g.spF} phase-${g.spA}`, g.spF, g.spA!));
      if (g.spB !== undefined) out.push(phaseRef(`${g.spF} phase-${g.spB}`, g.spF, g.spB));
    } else if (g.bareN !== undefined) {
      out.push({ kind: 'phase', raw: `phase-${g.bareN}`, folder: null, num: Number(g.bareN) });
    } else if (g.iN !== undefined) {
      out.push({ kind: 'integration', name: `I${g.iN}` });
    } else if (g.adrN !== undefined) {
      out.push({ kind: 'decision', ref: `ADR-${g.adrN}` });
    } else if (g.sec !== undefined) {
      out.push({ kind: 'decision', ref: `§${g.sec}` });
    } else if (g.hex !== undefined && mixedHex(g.hex)) {
      out.push({ kind: 'decision', ref: `commit ${g.hex}` });
    }
  }
  return out;
}

/**
 * 單獨的 phase-N 要緊接 `done`(反引號可有可無)才算 gate。
 * 說明裡的「phase-2 就是…」「記進 phase-2 工單」「同 phase-3」不是依賴。
 * 有資料夾前綴的寫法不走這條(parseGateRefs 已把它們標成 folder ≠ null)。
 */
function barePhaseRequiresDone(text: string, num: number): boolean {
  // 前綴寫法(`03 phase-2 `done``)不算單獨的 phase-N;否則說明裡的自己會被一起留下。
  const re = new RegExp(`(?<![A-Za-z0-9-][ \\t])(?<![A-Za-z0-9_/])phase-${num}(?![0-9])\\s*\`?\\s*done`);
  return re.test(text);
}

/**
 * 一行 `- 項目`、`- [ ]` 或 `- [x]` 的項目文字。不是清單行回 null。
 * 不把行首反引號當語法,不把行內 `#` 當註解——phase-2 讀工單檔頭的 `- 項目` 時重用這條。
 */
export function dashItemText(line: string): string | null {
  const box = /^\s*-\s+\[[ xX]\]\s?(.*)$/.exec(line);
  if (box) return box[1] ?? '';
  const plain = /^\s*-\s+(.*)$/.exec(line);
  if (plain) return plain[1] ?? '';
  return null;
}

export interface NextEntry {
  phase: number;
  noGate: boolean;
  refs: GateRef[];
}

function isPhaseHeader(line: string): boolean {
  return /^\s*\*\*phase-\d+\*\*/.test(line);
}

function isHeading(line: string): boolean {
  return /^\s*##\s/.test(line);
}

/**
 * `需要:` 之後收集 gate 文字:同一行、緊接的清單項、清單項的縮排續行。
 * 空白行不結束(真實 NEXT.md 常在 `需要:` 與清單之間空一行);`##` 或下一個
 * `**phase-N**` 才結束。縮排且以 `-` 開頭的子項是說明,不收。
 */
function collectGateText(lines: string[], start: number, chunks: string[]): number {
  let i = start;
  let started = chunks.length > 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isHeading(line) || isPhaseHeader(line)) break;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const box = /^\s*-\s+\[[ xX]\]\s?(.*)$/.exec(line);
    if (box) {
      chunks.push(box[1] ?? '');
      started = true;
      i++;
      continue;
    }
    const plain = /^-\s+(.*)$/.exec(line);
    if (plain) {
      chunks.push(plain[1] ?? '');
      started = true;
      i++;
      continue;
    }
    if (started && /^\s+\S/.test(line) && !/^\s+-\s/.test(line)) {
      chunks.push(line.trim());
      i++;
      continue;
    }
    if (!started) {
      i++;
      continue;
    }
    break;
  }
  return i;
}

/** 讀 NEXT.md 的 `**phase-N**` 宣告。`無 gate` 不抽後面的參照;勾選狀態不讀。 */
export function parseNext(nextMd: string): NextEntry[] {
  const lines = nextMd.split(/\r?\n/);
  const out: NextEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\*\*phase-(\d+)\*\*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const phase = Number(m[1]);
    const rest = (m[2] ?? '').trim();
    if (/^:\s*無\s*gate/.test(rest)) {
      out.push({ phase, noGate: true, refs: [] });
      continue;
    }
    const needs = /^需要\s*:(.*)$/.exec(rest);
    if (!needs) continue;
    const chunks: string[] = [];
    const same = (needs[1] ?? '').trim();
    if (same) chunks.push(same);
    i = collectGateText(lines, i + 1, chunks) - 1;
    const text = chunks.join('\n');
    const refs = parseGateRefs(text).filter((ref) => ref.kind !== 'phase' || ref.folder !== null || barePhaseRequiresDone(text, ref.num));
    out.push({ phase, noGate: false, refs });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────── 圖

function nodeName(folder: string, phase: number): string {
  return `${folder}/phase-${phase}`;
}

function lookupFolder(token: string, names: readonly string[]): string | null {
  if (names.includes(token)) return token;
  const hits = names.filter((n) => n.startsWith(`${token}-`));
  return hits.length === 1 ? hits[0]! : null;
}

interface PhaseNode {
  folder: string;
  phase: number;
  status: Status;
  node: string;
  declared: boolean;
  hasNeeds: boolean;
  refs: GateRef[];
}

function findCycles(needs: Map<string, string[]>): string[] {
  const all = new Set<string>();
  for (const [k, vs] of needs) {
    all.add(k);
    for (const v of vs) all.add(v);
  }
  const nodes = sortNatural([...all]);
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const [k, vs] of needs) adj.set(k, uniqueSorted(vs));
  const out: string[] = [];
  for (let si = 0; si < nodes.length; si++) {
    const start = nodes[si]!;
    const blocked = new Set(nodes.slice(0, si));
    const path = [start];
    const pathSet = new Set([start]);
    const dfs = (u: string): void => {
      for (const v of adj.get(u) ?? []) {
        if (blocked.has(v)) continue;
        if (v === start) {
          out.push(`${path.join(' -> ')} -> ${start}`);
          continue;
        }
        if (pathSet.has(v)) continue;
        path.push(v);
        pathSet.add(v);
        dfs(v);
        path.pop();
        pathSet.delete(v);
      }
    };
    dfs(start);
  }
  return sortNatural(out);
}

function lineKey(line: string): string {
  const i = line.indexOf(' ');
  return i === -1 ? '' : line.slice(i + 1);
}

function sortLines(lines: string[]): string[] {
  return [...lines].sort((a, b) => compareNatural(lineKey(a), lineKey(b)));
}

/** 純計算。不讀檔、不看時鐘、不看輸入順序。 */
export function analyzeTree(input: TreeInput): Analysis {
  const tagSet = new Set(input.tags);
  const tables = new Map<string, Map<number, Status>>();
  const problems: string[] = [];

  for (const folder of input.folders) {
    if (folder.featureMd === null) {
      problems.push(`PROBLEM no-phase-table ${folder.name}`);
      continue;
    }
    const table = findPhaseTable(folder.featureMd);
    // 只有表頭、沒有資料列,跟完全沒有表一樣:這個資料夾沒有 phase 可引用。
    if (!table || table.rows.length === 0) {
      problems.push(`PROBLEM no-phase-table ${folder.name}`);
      continue;
    }
    const byPhase = new Map<number, Status>();
    for (const row of table.rows) {
      if (!byPhase.has(row.phase)) byPhase.set(row.phase, row.status);
    }
    tables.set(folder.name, byPhase);
  }

  const knownFolders = [...tables.keys()];
  const nodes: PhaseNode[] = [];
  for (const folder of input.folders) {
    const byPhase = tables.get(folder.name);
    if (!byPhase) continue;
    const entries = folder.nextMd === null ? [] : parseNext(folder.nextMd);
    for (const [phase, status] of byPhase) {
      const mine = entries.filter((e) => e.phase === phase);
      nodes.push({
        folder: folder.name,
        phase,
        status,
        node: nodeName(folder.name, phase),
        declared: mine.length > 0,
        hasNeeds: mine.some((e) => !e.noGate),
        refs: mine.flatMap((e) => e.refs),
      });
    }
  }

  const statusOf = new Map<string, Status>();
  for (const n of nodes) statusOf.set(n.node, n.status);

  const edgeKeys = new Set<string>();
  const edges: [string, string][] = [];
  const needs = new Map<string, string[]>();

  function addEdge(from: string, to: string): void {
    const key = `${from}\0${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push([from, to]);
  }

  function addNeed(from: string, to: string): void {
    const list = needs.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    needs.set(from, list);
  }

  interface ResolvedPhase {
    node: PhaseNode;
    unmet: string[];
    decisions: string[];
    unresolved: string[];
  }
  const resolved: ResolvedPhase[] = [];

  for (const node of nodes) {
    const unmet: string[] = [];
    const decisions: string[] = [];
    const unresolved: string[] = [];
    const seenPhase = new Set<string>();
    const seenDecision = new Set<string>();
    const seenUnresolved = new Set<string>();
    for (const ref of node.refs) {
      if (ref.kind === 'decision') {
        if (!seenDecision.has(ref.ref)) {
          seenDecision.add(ref.ref);
          decisions.push(ref.ref);
        }
        continue;
      }
      if (ref.kind === 'integration') {
        addEdge(ref.name, node.node);
        if (!tagSet.has(ref.name)) unmet.push(ref.name);
        continue;
      }
      const folder = ref.folder === null ? node.folder : lookupFolder(ref.folder, knownFolders);
      const target = folder === null ? null : tables.get(folder);
      if (folder === null || !target || !target.has(ref.num)) {
        if (!seenUnresolved.has(ref.raw)) {
          seenUnresolved.add(ref.raw);
          unresolved.push(ref.raw);
        }
        continue;
      }
      const dep = nodeName(folder, ref.num);
      addEdge(dep, node.node);
      addNeed(node.node, dep);
      if (!seenPhase.has(dep)) {
        seenPhase.add(dep);
        if (statusOf.get(dep) !== 'done') unmet.push(dep);
      }
    }
    resolved.push({ node, unmet, decisions, unresolved });
  }

  const cycleTexts = findCycles(needs);
  const cycleNodes = new Set<string>();
  for (const text of cycleTexts) {
    for (const part of text.split(' -> ')) cycleNodes.add(part);
  }

  const ready: string[] = [];
  const blocked: string[] = [];
  const human: string[] = [];

  for (const { node, unmet, decisions, unresolved } of resolved) {
    for (const raw of unresolved) problems.push(`PROBLEM unresolved-ref ${node.node} ${raw}`);
    if (node.status === 'done' || node.status === 'in-progress') continue;
    for (const ref of uniqueSorted(decisions)) human.push(`HUMAN ${node.node} decision ${ref}`);
    if (node.status === 'blocked') {
      blocked.push(`BLOCKED ${node.node} by status:blocked`);
      continue;
    }
    if (node.status !== 'todo' && node.status !== 'ready') continue;
    if (!node.declared) {
      problems.push(`PROBLEM gate-not-declared ${node.node}`);
      continue;
    }
    const blockers = uniqueSorted(unmet);
    if (blockers.length > 0) blocked.push(`BLOCKED ${node.node} by ${blockers.join(',')}`);
    if (cycleNodes.has(node.node)) continue;
    if (unresolved.length > 0 || blockers.length > 0 || decisions.length > 0) continue;
    const note = node.status !== 'ready' && node.hasNeeds ? ` (table says ${node.status})` : '';
    ready.push(`READY ${node.node}${note}`);
  }

  for (const text of cycleTexts) problems.push(`PROBLEM cycle ${text}`);

  edges.sort((a, b) => {
    const c = compareNatural(a[0], b[0]);
    return c !== 0 ? c : compareNatural(a[1], b[1]);
  });

  const lines = [...sortLines(ready), ...sortLines(blocked), ...sortLines(human), ...sortLines(problems)];
  return {
    lines,
    edges,
    counts: { ready: ready.length, blocked: blocked.length, human: human.length, problems: problems.length },
  };
}

/** 記錄行、mermaid 圍欄、最後一行摘要。每行一個換行,結尾不是空行。 */
export function renderReport(analysis: Analysis): string {
  const { counts } = analysis;
  const body = [
    ...analysis.lines,
    '```mermaid',
    'graph TD',
    ...analysis.edges.map(([from, to]) => `    "${from}" --> "${to}"`),
    '```',
    `gate=dag result=OK ready=${counts.ready} blocked=${counts.blocked} human=${counts.human} problems=${counts.problems}`,
  ];
  return `${body.join('\n')}\n`;
}

// ───────────────────────────────────────────────────────────────── CLI

function usage(): never {
  process.stderr.write('Usage: npx tsx scripts/dag.ts --root <tree>\n');
  process.exit(2);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readTags(root: string): string[] {
  try {
    const out = execFileSync('git', ['-C', root, 'tag', '--list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

function readOptionalFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (!st.isFile()) fail(`not a file: ${path}`);
  return readFileSync(path, 'utf8');
}

function loadTree(root: string): TreeInput {
  const featuresDir = join(root, 'features');
  if (!existsSync(featuresDir) || !statSync(featuresDir).isDirectory()) fail(`no features directory: ${featuresDir}`);
  const folders: TreeInput['folders'] = [];
  for (const name of readdirSync(featuresDir)) {
    // 規格讀的是 features/<NN-name>/。steps、support、_template 不是功能資料夾。
    if (!/^\d{2}-/.test(name)) continue;
    const dir = join(featuresDir, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    folders.push({
      name,
      featureMd: readOptionalFile(join(dir, 'FEATURE.md')),
      nextMd: readOptionalFile(join(dir, 'NEXT.md')),
    });
  }
  return { folders, tags: readTags(root) };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--root' || !args[1]) usage();
  const root = resolve(args[1]);
  if (!existsSync(root)) fail(`root not found: ${root}`);
  let st;
  try {
    st = statSync(root);
  } catch {
    fail(`root not found: ${root}`);
  }
  if (!st.isDirectory()) fail(`root is not a directory: ${root}`);
  const report = renderReport(analyzeTree(loadTree(root)));
  process.stdout.write(report);
}

function invokedAsCli(): boolean {
  for (const arg of process.argv.slice(1, 3)) {
    if (!arg || arg.startsWith('-')) continue;
    try {
      if (resolve(arg) === SELF) return true;
    } catch {
      // 不是路徑就略過
    }
  }
  return false;
}

if (invokedAsCli()) {
  try {
    main();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`dag failed: ${msg}\n`);
    process.exit(2);
  }
}
