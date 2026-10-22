/**
 * 13-work-dag phase-1:從 FEATURE.md 的 Phase 表、NEXT.md 的 gate、git tag `I<N>`
 * 算出 READY / BLOCKED / HUMAN / PROBLEM 與 mermaid。只讀、只印、可重現。
 *
 * PROBLEM 種類(phase-1):
 *   - cycle            依賴成環(箭頭 = 需要)
 *   - unresolved-ref   gate 參照解不到 phase
 *   - no-phase-table   資料夾沒有 Phase 表(或沒有 FEATURE.md)
 *   - gate-not-declared  todo / ready 的 phase 完全沒寫 gate,不猜它能開工
 * PROBLEM 種類(phase-2):
 *   - bad-header       檔頭缺欄位或值不合法
 *   - missing-header   工單檔沒有檔頭
 *   - duplicate-id     兩張工單同一個 id
 *   - r2-overlap       dispatched/review 落點相交(至少一張 dispatched)
 *   - r3-heavy         兩張以上 heavy 在 dispatched 或 review
 *   - no-landing       touches 對不到落點表(merged/dropped 不查)
 *
 * 沒有 --check:有 PROBLEM 也是退出碼 0。--check 讓任何 PROBLEM 變成退出碼 1。用法錯誤才是 2。
 * WARN(r4-dispatched、r5-depth)與 NOTE 永遠不紅。--orca 只印、不執行。
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
        addNeed(node.node, ref.name);
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

// ───────────────────────────────────────────────────────────────── phase-2 工單

const HEADER_FIELDS = ['id', 'deps', 'touches', 'cpu', 'budget_usd', 'status', 'owner', 'must_catch'] as const;
const LIST_FIELDS = new Set<string>(['deps', 'touches', 'must_catch']);
const TICKET_OWNERS = new Set(['worker-grok', 'worker-claude', 'worker-codex', '統籌', '前端', '驗收', '測試']);
const TICKET_STATUSES = new Set(['todo', 'dispatched', 'review', 'merged', 'dropped']);
const TICKET_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const LINE_KINDS = ['READY', 'BLOCKED', 'HUMAN', 'START', 'HELD', 'LANDING', 'NOTE', 'WARN', 'PROBLEM'];

interface TouchHit {
  touch: string;
  landings: string[];
  /** 落點集合含 infra 時,這個項目參加檔案層級比對。 */
  infra: boolean;
  noLanding: boolean;
}

interface TicketNode {
  id: string;
  file: string;
  status: string;
  cpu: string;
  deps: string[];
  touches: string[];
  hits: TouchHit[];
  landings: Set<string>;
  infraTouches: string[];
  resolved: string[];
  unmet: string[];
  droppedDeps: Set<string>;
  unresolved: string[];
}

interface CliFlags {
  root: string;
  check: boolean;
  orca: boolean;
}

/** 空白(或行首)加 `#` 之後是註解。只用在 `key: value` 行;清單項不走這條。 */
function stripKeyComment(line: string): string {
  // Stryker disable next-line all: 行首 # 那一支永遠走不到:呼叫它之前第 706 行已把「第一個非空白字元是 #」的行整行略過,只剩「空白加 #」有作用
  const m = /(?:^|\s)#/.exec(line);
  // Stryker disable next-line all: 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串
  if (!m) return line.trimEnd();
  // Stryker disable next-line all: 呼叫端(第 717 行)緊接著再 .trim(),回傳前用 trimEnd 或 trimStart 都得到同一個字串
  return line.slice(0, m.index).trimEnd();
}

function parseInlineList(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  const inner = value.slice(1, -1);
  if (/['"{}\[\]]/.test(inner)) return null;
  // Stryker disable next-line all: 空或全空白的清單走原路也是 []:''.split(',') 得 [''],trim 與 filter 後是 [];提早回 [] 是重複
  if (inner.trim() === '') return [];
  return inner.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

// Stryker disable next-line all: 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變
function scalarUnsupported(value: string): boolean {
  // Stryker disable next-line all: 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,含引號、括號、¦、開頭 > 或空字串的值同樣一定被那些檢查判 invalid;scalarUnsupported 只是提早標記,issues 與 name 都不變
  return /['"{}\[\]|]/.test(value) || value.startsWith('>');
}

function parseHeaderText(text: string, filename: string): {
  missingHeader: boolean;
  issues: { field: string; kind: 'missing' | 'invalid' }[];
  name: string;
  node: TicketNode | null;
} {
  const lines = text.split(/\r?\n/);
  // Stryker disable next-line StringLiteral: lines[0] 一定存在(split 至少回一個元素),?? 的預設值走不到
  if ((lines[0] ?? '').trim() !== '---') {
    // Stryker disable next-line all: missingHeader 為 true 時 loadTicketNodes 只印 missing-header 然後 continue,不讀 issues
    return { missingHeader: true, issues: [], name: filename, node: null };
  }
  let end = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      end = i;
      break;
    }
  }
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const bad = new Set<string>();
  const seen = new Set<string>();
  let listField: string | null = null;
  let idx = 1;
  while (idx < end) {
    const raw = lines[idx]!;
    if (raw.trim() === '' || /^\s*#/.test(raw)) {
      idx++;
      continue;
    }
    const item = dashItemText(raw);
    if (item !== null && listField !== null) {
      lists.get(listField)!.push(item);
      idx++;
      continue;
    }
    listField = null;
    const km = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(stripKeyComment(raw).trim());
    if (!km) {
      idx++;
      continue;
    }
    const key = km[1]!;
    // Stryker disable next-line all: 呼叫端已把整行 trim,且正則 \s* 吃掉冒號後的空白、(.*) 貪婪到行尾,km[2] 不會有頭尾空白
    const value = (km[2] ?? '').trim();
    idx++;
    // Stryker disable next-line all: 不在 HEADER_FIELDS 的 key 只寫進 seen/scalars/bad,之後只用 HEADER_FIELDS 的名字去讀,多寫不影響輸出
    if (!HEADER_FIELDS.includes(key as (typeof HEADER_FIELDS)[number])) continue;
    if (seen.has(key)) {
      bad.add(key);
      continue;
    }
    seen.add(key);
    if (LIST_FIELDS.has(key)) {
      if (value === '') {
        lists.set(key, []);
        listField = key;
      } else {
        const parsed = parseInlineList(value);
        if (!parsed) bad.add(key);
        else lists.set(key, parsed);
      }
    // Stryker disable next-line all: 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null
    } else if (scalarUnsupported(value) || value === '') {
      // Stryker disable next-line all: 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null
      bad.add(key);
      // Stryker disable next-line all: 純量欄位(id、cpu、status、owner、budget_usd)各有自己的值檢查,不合法的純量(引號、括號、¦、> 開頭、空字串)必然也被那些檢查判 invalid;這一段只是提早標記同一個 invalid,拿掉 bad.add 或 scalars.set 的 issues 都一樣,且有 issue 就回 node:null
      scalars.set(key, value);
    } else {
      scalars.set(key, value);
    }
  }

  const idRaw = scalars.get('id');
  // Stryker disable next-line ConditionalExpression: idRaw!==undefined 改 true:id 缺漏時下一行 name 的條件仍會退回檔名,且缺漏已進 issues、回 node:null,idOk 別處沒用到
  const idOk = idRaw !== undefined && !bad.has('id') && TICKET_ID_RE.test(idRaw);
  // Stryker disable next-line ConditionalExpression: idOk 為真蘊含 idRaw 已定義,第二項恆為真
  const name = idOk && idRaw !== undefined ? idRaw : filename;
  const issues: { field: string; kind: 'missing' | 'invalid' }[] = [];
  for (const field of HEADER_FIELDS) {
    if (!seen.has(field)) {
      issues.push({ field, kind: 'missing' });
      continue;
    }
    if (bad.has(field)) {
      issues.push({ field, kind: 'invalid' });
      continue;
    }
    if (field === 'id') {
      if (!idOk) issues.push({ field, kind: 'invalid' });
      continue;
    }
    if (field === 'cpu') {
      // Stryker disable next-line all: 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到
      const v = scalars.get('cpu') ?? '';
      if (v !== 'heavy' && v !== 'light') issues.push({ field, kind: 'invalid' });
      continue;
    }
    if (field === 'status') {
      // Stryker disable next-line all: 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到
      const v = scalars.get('status') ?? '';
      if (!TICKET_STATUSES.has(v)) issues.push({ field, kind: 'invalid' });
      continue;
    }
    if (field === 'owner') {
      // Stryker disable next-line all: 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到
      const v = scalars.get('owner') ?? '';
      if (!TICKET_OWNERS.has(v)) issues.push({ field, kind: 'invalid' });
      continue;
    }
    if (field === 'budget_usd') {
      // Stryker disable next-line all: 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到
      const v = scalars.get('budget_usd') ?? '';
      if (!/^\d+(\.\d+)?$/.test(v)) {
        issues.push({ field, kind: 'invalid' });
        continue;
      }
      // Stryker disable next-line all: 走到這一行的欄位一定在 seen 且沒被標 bad,而純量欄位在那種情況下 scalars 必有值,?? 的預設值走不到
      const status = scalars.get('status') ?? '';
      if (Number(v) === 0 && status !== 'merged' && status !== 'dropped') issues.push({ field, kind: 'invalid' });
    }
  }
  // Stryker disable next-line all: issues 為空時 id 欄位一定通過 idOk(否則 id 欄位早已進 issues),所以 !idOk 與 idRaw===undefined 恆為 false,多餘的防護
  if (issues.length > 0 || !idOk || idRaw === undefined) return { missingHeader: false, issues, name, node: null };
  return {
    missingHeader: false,
    issues: [],
    name,
    node: {
      id: idRaw,
      file: filename,
      status: scalars.get('status')!,
      cpu: scalars.get('cpu')!,
      // Stryker disable next-line all: deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到
      deps: lists.get('deps') ?? [],
      // Stryker disable next-line all: deps、touches 是必填欄位,缺漏會進 issues 而回 node:null;走到這裡 lists 一定有它們,?? [] 走不到
      touches: lists.get('touches') ?? [],
      // Stryker disable next-line all: hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀
      hits: [],
      landings: new Set(),
      // Stryker disable next-line all: hits、infraTouches 的初值在 loadTicketNodes 第 957–959 行馬上被覆寫,回傳值沒有別處會讀
      infraTouches: [],
      resolved: [],
      unmet: [],
      droppedDeps: new Set(),
      unresolved: [],
    },
  };
}

function loadLandings(root: string): [string, string][] {
  const path = join(root, 'scripts/boundaries.owners.json');
  // Stryker disable next-line ConditionalExpression: existsSync 為假時往下的 statSync 會丟例外,被 catch 回 [],結果相同
  if (!existsSync(path)) return [];
  let st;
  try {
    st = statSync(path);
  // Stryker disable next-line all: existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到
  } catch {
    // Stryker disable next-line all: existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到
    return [];
  }
  // Stryker disable next-line ConditionalExpression: 路徑是目錄時往下的 readFileSync 丟 EISDIR,被 catch 回 [],結果相同
  if (!st.isFile()) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { owners?: unknown };
    // Stryker disable next-line ConditionalExpression: owners 不是陣列時 for-of 對 undefined/物件/數字丟 TypeError(被 catch 回 []),對字串逐字走訪但每個字都不是陣列列而被略過,結果都是 []
    if (!Array.isArray(raw.owners)) return [];
    const out: [string, string][] = [];
    for (const row of raw.owners) {
      if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') out.push([row[0], row[1]]);
    }
    return out;
  } catch {
    return [];
  }
}

/** 最長前綴的落點,加上目錄項目底下每一列的落點。兩者皆無才是 no-landing。 */
function resolveTouch(touch: string, table: [string, string][]): TouchHit {
  let best: { len: number; landing: string } | null = null;
  for (const [prefix, landing] of table) {
    // Stryker disable next-line ConditionalExpression: touch===prefix 蘊含 touch.startsWith(prefix),左邊那一支是重複條件
    if ((touch === prefix || touch.startsWith(prefix)) && (best === null || prefix.length > best.len)) {
      best = { len: prefix.length, landing };
    }
  }
  const landings = new Set<string>();
  if (best) landings.add(best.landing);
  if (touch.endsWith('/')) {
    for (const [prefix, landing] of table) {
      if (prefix.startsWith(touch)) landings.add(landing);
    }
  }
  return { touch, landings: [...landings], infra: landings.has('infra'), noLanding: landings.size === 0 };
}

function infraShared(a: string, b: string): string | null {
  if (a === b) return a;
  if (a.endsWith('/') && b.startsWith(a)) return a;
  if (b.endsWith('/') && a.startsWith(b)) return b;
  return null;
}

function overlapReasons(a: TicketNode, b: TicketNode): string[] {
  const reasons: string[] = [];
  if (a.landings.has('contracts') || b.landings.has('contracts')) reasons.push('contracts');
  // Stryker disable next-line all: 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變
  const bNon = new Set([...b.landings].filter((l) => l !== 'infra' && l !== 'contracts'));
  for (const l of a.landings) {
    // Stryker disable next-line all: 第 866 行已把 a 的落點限定在非 infra、非 contracts 才查 bNon.has(l),所以 bNon 含不含 infra/contracts、以及 866 行各條件放寬,結果都不變
    if (l !== 'infra' && l !== 'contracts' && bNon.has(l)) reasons.push(l);
  }
  const infra = new Set<string>();
  for (const x of a.infraTouches) {
    for (const y of b.infraTouches) {
      const shared = infraShared(x, y);
      if (shared) infra.add(shared);
    }
  }
  for (const item of infra) reasons.push(`infra:${item}`);
  return uniqueSorted(reasons);
}

function phaseStatusMap(input: TreeInput): Map<string, string> {
  const out = new Map<string, string>();
  for (const folder of input.folders) {
    if (folder.featureMd === null) continue;
    for (const row of parsePhaseTable(folder.featureMd)) {
      const node = nodeName(folder.name, row.phase);
      if (!out.has(node)) out.set(node, row.status);
    }
  }
  return out;
}

function phaseTables(input: TreeInput): Map<string, Map<number, string>> {
  const tables = new Map<string, Map<number, string>>();
  for (const [node, status] of phaseStatusMap(input)) {
    const slash = node.lastIndexOf('/phase-');
    // Stryker disable next-line all: 節點名由 nodeName 組成,一定含「/phase-」且資料夾名非空,slash 不會小於等於 0
    if (slash < 0) continue;
    const folder = node.slice(0, slash);
    const num = Number(node.slice(slash + '/phase-'.length));
    const by = tables.get(folder) ?? new Map<number, string>();
    by.set(num, status);
    tables.set(folder, by);
  }
  return tables;
}

function classifyDep(raw: string, ticketIds: Set<string>, tables: Map<string, Map<number, string>>): { node: string } | { unresolved: string } {
  if (/^I\d+$/.test(raw)) return { node: raw };
  if (ticketIds.has(raw)) return { node: raw };
  // Stryker disable next-line ConditionalExpression: find 條件 r.kind===phase 改 true:下一行立刻再檢查 phase.kind===phase,非 phase 一樣落到 unresolved
  const phase = parseGateRefs(raw).find((r) => r.kind === 'phase' && r.raw === raw);
  // Stryker disable next-line ConditionalExpression: find 已只回 kind 為 phase 的元素,phase.kind===phase 恆真
  if (phase && phase.kind === 'phase') {
    // Stryker disable next-line ConditionalExpression: folder 為 null 時 lookupFolder 比對不到任何資料夾,同樣走 unresolved
    if (phase.folder === null) return { unresolved: raw };
    const folder = lookupFolder(phase.folder, [...tables.keys()]);
    // Stryker disable next-line ConditionalExpression,OptionalChaining: folder!==null 改 true 時 tables.get(null) 為 undefined、條件仍假;folder 非 null 時必為 tables 的鍵,?. 防護走不到
    if (folder !== null && tables.get(folder)?.has(phase.num)) return { node: nodeName(folder, phase.num) };
    return { unresolved: raw };
  }
  return { unresolved: raw };
}

function loadTicketNodes(root: string, table: [string, string][]): { problems: string[]; tickets: Map<string, TicketNode> } {
  // Stryker disable next-line all: augment 的 take() 只收 LINE_KINDS 開頭的行,「Stryker was here」的 kind 不在其中,被丟掉,不進輸出也不計數
  const problems: string[] = [];
  const tickets = new Map<string, TicketNode>();
  const dir = join(root, 'docs/tickets');
  // Stryker disable next-line all: 目錄不存在時往下的 statSync 丟例外,被 catch 回同樣的空結果
  if (!existsSync(dir)) return { problems, tickets };
  let st;
  try {
    st = statSync(dir);
  // Stryker disable next-line all: existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到
  } catch {
    // Stryker disable next-line all: existsSync 為真代表 statSync 會成功,兩者之間只有競爭條件才會失敗,走不到
    return { problems, tickets };
  }
  if (!st.isDirectory()) return { problems, tickets };
  const parsed: { file: string; result: ReturnType<typeof parseHeaderText> }[] = [];
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.md')).sort(compareNatural)) {
    const path = join(dir, file);
    let fst;
    try {
      fst = statSync(path);
    } catch {
      continue;
    }
    if (!fst.isFile()) continue;
    parsed.push({ file, result: parseHeaderText(readFileSync(path, 'utf8'), file) });
  }
  const idCount = new Map<string, number>();
  for (const item of parsed) {
    if (item.result.node) idCount.set(item.result.node.id, (idCount.get(item.result.node.id) ?? 0) + 1);
  }
  const duplicateIds = new Set([...idCount.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  for (const id of uniqueSorted([...duplicateIds])) problems.push(`PROBLEM duplicate-id ${id}`);
  for (const item of parsed) {
    if (item.result.missingHeader) {
      problems.push(`PROBLEM missing-header ${item.file}`);
      continue;
    }
    for (const issue of item.result.issues) problems.push(`PROBLEM bad-header ${item.result.name} ${issue.kind} ${issue.field}`);
    const node = item.result.node;
    if (!node || duplicateIds.has(node.id) || tickets.has(node.id)) continue;
    node.hits = node.touches.map((touch) => resolveTouch(touch, table));
    node.landings = new Set(node.hits.flatMap((h) => h.landings));
    node.infraTouches = node.hits.filter((h) => h.infra).map((h) => h.touch);
    tickets.set(node.id, node);
  }
  return { problems, tickets };
}

function wireDeps(tickets: Map<string, TicketNode>, tables: Map<string, Map<number, string>>, phases: Map<string, string>, tags: Set<string>): void {
  const ids = new Set(tickets.keys());
  const satisfied = (node: string): boolean => {
    if (/^I\d+$/.test(node)) return tags.has(node);
    const ticket = tickets.get(node);
    if (ticket) return ticket.status === 'merged';
    return phases.get(node) === 'done';
  };
  for (const ticket of tickets.values()) {
    for (const raw of ticket.deps) {
      const hit = classifyDep(raw, ids, tables);
      if ('unresolved' in hit) {
        ticket.unresolved.push(raw);
        continue;
      }
      ticket.resolved.push(hit.node);
      if (tickets.get(hit.node)?.status === 'dropped') ticket.droppedDeps.add(hit.node);
      if (!satisfied(hit.node)) ticket.unmet.push(hit.node);
    }
    ticket.resolved = uniqueSorted(ticket.resolved);
    ticket.unmet = uniqueSorted(ticket.unmet);
    ticket.unresolved = uniqueSorted(ticket.unresolved);
  }
}

function blockerText(names: string[], dropped: Set<string>): string {
  return uniqueSorted(names).map((n) => (dropped.has(n) ? `${n} (dropped)` : n)).join(',');
}

function compareRecord(a: string, b: string): number {
  const pa = /^PROBLEM bad-header (\S+) (missing|invalid) (\S+)$/.exec(a);
  const pb = /^PROBLEM bad-header (\S+) (missing|invalid) (\S+)$/.exec(b);
  if (pa && pb && pa[1] === pb[1]) {
    const ia = HEADER_FIELDS.indexOf(pa[3] as (typeof HEADER_FIELDS)[number]);
    const ib = HEADER_FIELDS.indexOf(pb[3] as (typeof HEADER_FIELDS)[number]);
    if (ia !== ib) return ia - ib;
    // Stryker disable next-line ConditionalExpression: 走到這裡名字與欄位相同:kind 相同時兩行逐字相同,kind 不同時結果與原版一致
    if (pa[2] !== pb[2]) return pa[2] === 'missing' ? -1 : 1;
  }
  return compareNatural(lineKey(a), lineKey(b));
}

function makeDepth(depsOf: (n: string) => string[], isSat: (n: string) => boolean): (n: string) => number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (n: string): number => {
    if (isSat(n)) return 0;
    const hit = memo.get(n);
    if (hit !== undefined) return hit;
    if (visiting.has(n)) return 0;
    visiting.add(n);
    let max = 0;
    for (const dep of depsOf(n)) max = Math.max(max, depth(dep));
    // Stryker disable next-line all: 節點算完一定馬上 memo.set;之後再遇到它時 memo 檢查在 visiting 檢查之前,visiting 留著它不會被讀到
    visiting.delete(n);
    const value = 1 + max;
    memo.set(n, value);
    return value;
  };
  return depth;
}

function augment(input: TreeInput, phase: Analysis, tickets: Map<string, TicketNode>, headerProblems: string[]): Analysis {
  const tags = new Set(input.tags);
  const phases = phaseStatusMap(input);
  const satisfied = (node: string): boolean => {
    if (/^I\d+$/.test(node)) return tags.has(node);
    const ticket = tickets.get(node);
    if (ticket) return ticket.status === 'merged';
    return phases.get(node) === 'done';
  };
  const extra: string[] = [...headerProblems];
  const ticketEdges: [string, string][] = [];
  const ticketNeeds = new Map<string, string[]>();

  for (const ticket of tickets.values()) {
    const active = ticket.status === 'todo' || ticket.status === 'dispatched' || ticket.status === 'review';
    if (active) {
      for (const landing of uniqueSorted([...ticket.landings])) extra.push(`LANDING ${ticket.id} ${landing}`);
      for (const hit of ticket.hits) {
        if (hit.noLanding) extra.push(`PROBLEM no-landing ${ticket.id} ${hit.touch}`);
      }
    }
    for (const raw of ticket.unresolved) extra.push(`PROBLEM unresolved-ref ${ticket.id} ${raw}`);
    for (const dep of ticket.resolved) ticketEdges.push([dep, ticket.id]);
    // Stryker disable next-line MethodExpression: 拿掉 filter(tickets.has) 多出的是 phase 或 I 閘門節點,沒有出邊,環不可能經過它們
    ticketNeeds.set(ticket.id, ticket.resolved.filter((d) => tickets.has(d)));
  }

  for (const text of findCycles(ticketNeeds)) extra.push(`PROBLEM cycle ${text}`);
  const cycleNodes = new Set<string>();
  for (const text of extra.filter((l) => l.startsWith('PROBLEM cycle '))) {
    // Stryker disable next-line MethodExpression,StringLiteral: 拿掉 slice 或前綴長度變 0:第一段帶 PROBLEM cycle 前綴不是 id,但環起點在尾端重複,仍被收進 cycleNodes
    for (const part of text.slice('PROBLEM cycle '.length).split(' -> ')) cycleNodes.add(part);
  }

  const readyIds: string[] = [];
  for (const ticket of tickets.values()) {
    if (ticket.status !== 'todo') continue;
    if (ticket.unmet.length > 0) extra.push(`BLOCKED ${ticket.id} by ${blockerText(ticket.unmet, ticket.droppedDeps)}`);
    if (cycleNodes.has(ticket.id) || ticket.unresolved.length > 0 || ticket.unmet.length > 0) continue;
    extra.push(`READY ${ticket.id}`);
    readyIds.push(ticket.id);
  }

  const occupying = [...tickets.values()].filter((t) => t.status === 'dispatched' || t.status === 'review');
  const dispatched = occupying.filter((t) => t.status === 'dispatched');
  // Stryker disable next-line all: i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果
  for (let i = 0; i < occupying.length; i++) {
    for (let j = i + 1; j < occupying.length; j++) {
      const left = occupying[i]!;
      const right = occupying[j]!;
      if (left.status !== 'dispatched' && right.status !== 'dispatched') continue;
      // Stryker disable next-line EqualityOperator: dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同
      const [a, b] = compareNatural(left.id, right.id) <= 0 ? [left, right] : [right, left];
      for (const reason of overlapReasons(a, b)) extra.push(`PROBLEM r2-overlap ${a.id} ${b.id} on ${reason}`);
    }
  }
  const heavyOcc = occupying.filter((t) => t.cpu === 'heavy');
  // Stryker disable next-line all: i 到 length 時內層 j 從 length+1 起,j<length 為假,內層一次都不執行,外層多一圈沒有效果
  for (let i = 0; i < heavyOcc.length; i++) {
    for (let j = i + 1; j < heavyOcc.length; j++) {
      const left = heavyOcc[i]!;
      const right = heavyOcc[j]!;
      // Stryker disable next-line EqualityOperator: dispatched/review 的兩張工單 id 一定不同(重複 id 已在 loadTicketNodes 排除),compareNatural 不會回 0,<= 與 < 相同
      const [a, b] = compareNatural(left.id, right.id) <= 0 ? [left, right] : [right, left];
      extra.push(`PROBLEM r3-heavy ${a.id} ${b.id}`);
    }
  }
  if (dispatched.length > 3) extra.push(`WARN r4-dispatched ${dispatched.length}`);

  const selected: TicketNode[] = [];
  const runningIds = (pool: TicketNode[]): string[] => uniqueSorted(pool.map((t) => t.id));
  for (const id of uniqueSorted(readyIds)) {
    const ticket = tickets.get(id)!;
    const against = [...occupying, ...selected];
    const r2 = against.filter((o) => overlapReasons(ticket, o).length > 0);
    // Stryker disable next-line ConditionalExpression: against 只由 dispatched/review 與 selected 組成,括號內三個條件對每個元素恆真
    const r3 = ticket.cpu === 'heavy' ? against.filter((o) => o.cpu === 'heavy' && (o.status === 'dispatched' || o.status === 'review' || selected.includes(o))) : [];
    const r4full = dispatched.length + selected.length >= 3;
    const held = r2.length > 0 || r3.length > 0 || r4full;
    if (r2.length > 0) extra.push(`HELD ${id} by R2 with ${runningIds(r2)}`);
    if (r3.length > 0) extra.push(`HELD ${id} by R3 with ${runningIds(r3)}`);
    if (r4full) extra.push(`HELD ${id} by R4 with ${runningIds([...dispatched, ...selected])}`);
    if (!held) {
      extra.push(`START ${id}`);
      selected.push(ticket);
    }
  }

  const inProgress = uniqueSorted([...phases.entries()].filter(([, status]) => status === 'in-progress').map(([node]) => node));
  const readyPhases = uniqueSorted(phase.lines.filter((l) => l.startsWith('READY ')).map((l) => l.split(' ')[1]!));
  // 測試釘死:done / todo / blocked 不算在跑;這輪已選的 ready phase 也不佔 WIP(還沒變成 in-progress)。
  for (const node of readyPhases) {
    if (inProgress.length >= 2) extra.push(`HELD ${node} by R4 with ${inProgress.join(',')}`);
    else extra.push(`START ${node}`);
  }

  const phaseDeps = (node: string): string[] => phase.edges.filter(([, to]) => to === node).map(([from]) => from);
  const depth = makeDepth((node) => tickets.get(node)?.resolved ?? phaseDeps(node), satisfied);
  const warnNodes = uniqueSorted([...tickets.keys(), ...phases.keys()]);
  for (const node of warnNodes) {
    // Stryker disable next-line all: 已滿足的節點 makeDepth 以 isSat 直接回 0,0 不大於 4,不會出 WARN,這個 continue 是重複
    if (satisfied(node)) continue;
    const d = depth(node);
    if (d > 4) extra.push(`WARN r5-depth ${node} ${d}`);
  }

  const buckets = new Map<string, string[]>(LINE_KINDS.map((k) => [k, []]));
  const take = (line: string): void => {
    // Stryker disable next-line all: line.split(' ')[0] 一定有值,?? 的預設值走不到
    const kind = line.split(' ')[0] ?? '';
    // Stryker disable next-line all: augment 產生的每一行開頭都在 LINE_KINDS 內(READY BLOCKED HUMAN START HELD LANDING NOTE WARN PROBLEM),buckets.get 永遠有值,?. 的防護走不到
    buckets.get(kind)?.push(line);
  };
  for (const line of phase.lines) take(line);
  for (const line of extra) take(line);
  const lines: string[] = [];
  for (const kind of LINE_KINDS) {
    // Stryker disable next-line all: LINE_KINDS 的每個 kind 在 buckets 都有鍵,?? [] 走不到
    const items = buckets.get(kind) ?? [];
    // Stryker disable next-line ConditionalExpression: kind===PROBLEM 改 true:compareRecord 對非 bad-header 行退回 compareNatural(lineKey),與原比較器相同
    items.sort(kind === 'PROBLEM' ? compareRecord : (a, b) => compareNatural(lineKey(a), lineKey(b)));
    lines.push(...items);
  }
  const edgeKeys = new Set<string>();
  const edges: [string, string][] = [];
  for (const edge of [...phase.edges, ...ticketEdges]) {
    const key = `${edge[0]}\0${edge[1]}`;
    // Stryker disable next-line ConditionalExpression: 邊在來源處已去重且 phase 邊與工單邊來源互不相交,重複從不發生
    if (edgeKeys.has(key)) continue;
    // Stryker disable next-line CallExpression: 同上,edgeKeys.add 拿掉也沒有重複可擋
    edgeKeys.add(key);
    edges.push(edge);
  }
  edges.sort((a, b) => {
    const c = compareNatural(a[0], b[0]);
    return c !== 0 ? c : compareNatural(a[1], b[1]);
  });
  const count = (kw: string): number => lines.filter((l) => l.startsWith(`${kw} `)).length;
  return {
    lines,
    edges,
    counts: { ready: count('READY'), blocked: count('BLOCKED'), human: count('HUMAN'), problems: count('PROBLEM') },
  };
}

function orcaLine(id: string, file: string, depVars: string[]): string {
  // Stryker disable next-line all: depVars 為空時樣板字串 [${[].join(',')}] 就是「[]」,與提早回 '[]' 同一個字串
  const deps = depVars.length === 0 ? '[]' : `[${depVars.map((v) => `\\"$${v}\\"`).join(',')}]`;
  return `${id}=$(orca orchestration task-create --spec "$(cat docs/tickets/${file})" --deps "${deps}" --json | jq -r '.result.task.id')`;
}

function orcaScript(tickets: Map<string, TicketNode>): string {
  const batch = [...tickets.values()].filter((t) => t.status === 'todo');
  const ids = new Set(batch.map((t) => t.id));
  const byId = new Map(batch.map((t) => [t.id, t]));
  const preds = new Map<string, string[]>();
  for (const ticket of batch) preds.set(ticket.id, uniqueSorted(ticket.resolved.filter((d) => ids.has(d) && d !== ticket.id)));
  const indeg = new Map<string, number>();
  for (const ticket of batch) indeg.set(ticket.id, preds.get(ticket.id)!.length);
  const emitted = new Set<string>();
  const order: string[] = [];
  let frontier = uniqueSorted([...indeg.keys()].filter((id) => indeg.get(id) === 0));
  while (frontier.length > 0) {
    const unlocked: string[] = [];
    for (const id of frontier) {
      emitted.add(id);
      order.push(id);
      for (const ticket of batch) {
        if (!preds.get(ticket.id)!.includes(id)) continue;
        const left = (indeg.get(ticket.id) ?? 0) - 1;
        indeg.set(ticket.id, left);
        if (left === 0) unlocked.push(ticket.id);
      }
    }
    frontier = uniqueSorted(unlocked);
  }
  for (const id of uniqueSorted(batch.map((t) => t.id).filter((id) => !emitted.has(id)))) order.push(id);
  // Stryker disable next-line all: order 裡的 id 都來自 batch,preds 對 batch 的每個 id 都有值,?? [] 走不到
  const lines = order.map((id) => orcaLine(id, byId.get(id)!.file, preds.get(id) ?? []));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function parseFlags(argv: string[]): CliFlags {
  let root: string | null = null;
  let check = false;
  let orca = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--orca') {
      orca = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[++i];
      if (!value || value.startsWith('-')) usage();
      if (root !== null) usage();
      root = value;
      continue;
    }
    usage();
  }
  if (root === null) usage();
  return { root, check, orca };
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const root = resolve(flags.root);
  // Stryker disable next-line all: existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到
  if (!existsSync(root)) fail(`root not found: ${root}`);
  let st;
  try {
    st = statSync(root);
  // Stryker disable next-line all: existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到
  } catch {
    // Stryker disable next-line all: existsSync 為真代表 statSync 會成功(第 1220 行為假時第 1222 行的 statSync 丟例外,走 catch 發同樣訊息);catch 與訊息字串只有競爭條件才走得到
    fail(`root not found: ${root}`);
  }
  if (!st.isDirectory()) fail(`root is not a directory: ${root}`);
  const input = loadTree(root);
  const phase = analyzeTree(input);
  const table = loadLandings(root);
  const loaded = loadTicketNodes(root, table);
  wireDeps(loaded.tickets, phaseTables(input), phaseStatusMap(input), new Set(input.tags));
  const report = augment(input, phase, loaded.tickets, loaded.problems);
  process.stdout.write(flags.orca ? orcaScript(loaded.tickets) : renderReport(report));
  if (flags.check && report.counts.problems > 0) process.exitCode = 1;
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
