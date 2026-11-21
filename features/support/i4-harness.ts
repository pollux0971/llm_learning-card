/**
 * I4 整合(docs/integration/i4-two-card-system.feature)的共用佈置與觀測(工單 T66)。測試 agent 寫;產品程式一個字沒改。
 *
 * 只有「佈置」與「觀測」,沒有教學卡或排程的邏輯:不排卡、不算到期。預期值由步驟檔自己寫死或向排程的轉移函式問。
 * 純輔助模組(沒有 cucumber / vitest 相依):步驟檔與單元測試都可以 import。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,見 review-session-harness.ts),不碰真的 learning/,不打網路。
 *
 * 世界(`createI4Vault`,設定檔三個類別,順序 security、language、network):
 *
 *   security(資安,require_raw)
 *     sec-0001  level 0                                   prereqs []
 *     sec-0002  level 1  parent sec-0001                   prereqs [sec-0001, lang-0001]   ← lang-0001 在別的類別,沒學就會有提示
 *     sec-0003  level 1  parent sec-0001                   prereqs [sec-0001]
 *     deps.json 的 security 圖:nodes 三張;edges [0001→0002]、[lang-0001→0002](跨類別的邊放在後學那張所在的類別圖)、[0001→0003]
 *     order 檔:sec-0001, sec-0003, sec-0002   ← 是圖的拓樸順序,而且跟 id 順序不同(id 順序是 0001、0002、0003)
 *   language(語言)
 *     lang-0001, lang-0002  level 0,沒有先備;order 檔:lang-0002, lang-0001(跟 id 順序不同);沒有邊
 *   network(網路)
 *     net-0001  level 0;沒有 order 檔
 *
 * 每張卡都有考題檔。`state/reviews.json` 一開始是 `{}`:什麼都沒學。`log.jsonl` 是空的。
 * 這個佈置要過真的 lint(`prereq_mismatch`、`missing_prereq`、`cycle` 都是 0),步驟在背景裡量,見 `lintNumbers`。
 *
 * 「視窗」不是替身:真的側車子行程(`scripts/review-sidecar.ts`)、真的 `createReviewClient`、
 * 讀卡片內文走 webview 的 `createLearningFs()`,`invoke` 轉到真的 lc-fs probe(Rust 那份 learning_fs;learning 根目錄由指標檔給,
 * 不是請求裡的 `root`,所以 config/vault-id 與側車看到的是同一個標記)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReviewClient, type ReviewClient } from '../../apps/desktop/src/webview/review-client.js';
import { runProbe } from '../../apps/desktop/src/test-support/probe.js';
import { loadWebviewLearningFs, type WebviewLearningFs } from '../../apps/desktop/src/test-support/webview-learning-fs.js';
import { lint } from '../../packages/core/src/lint/index.js';
import type { LintProblemType } from '../../packages/core/src/lint/index.js';
import { applyLearnedTransition } from '../../packages/core/src/scheduler/transitions.js';
import { createVault, ensureCards, runReview, TODAY, writeReviews, readReviews, type ReviewRecord, type Vault } from './review-session-harness.js';
import { spawnSidecar, type Sidecar } from './review-sidecar-harness.js';
import { writeCard, writeDeps, writeOrderFile, writeQuestions, type CardSpec } from './t43-harness.js';
import { makeSession, type Session } from './test-card-rig.js';

export { TODAY };
export type { Vault };

export const FAKE_DEEPEN = join(import.meta.dirname, '../steps/_fake-deepen-cloud.mjs');
export const TOMORROW = '2026-09-11';

export const SECURITY_ORDER = ['sec-0001', 'sec-0003', 'sec-0002'];
export const SECURITY_ID_ORDER = ['sec-0001', 'sec-0002', 'sec-0003'];
export const LANGUAGE_ORDER = ['lang-0002', 'lang-0001'];
/** 顯示中那張「用來深入」的卡:level 1(sec-0001 學過之後,order 檔裡第一張沒學的) */
export const DEEPEN_PARENT = 'sec-0003';

export type GraphEdges = [string, string][];
export interface Graph {
  nodes: string[];
  edges: GraphEdges;
}

// ---------------------------------------------------------------- 佈置

export function createI4Vault(): Vault {
  const vault = createVault({ cards: 3 });
  writeFileSync(
    join(vault.dir, 'config/categories.yaml'),
    '- id: security\n  name: 資安\n  require_raw: true\n- id: language\n  name: 語言\n  require_raw: false\n- id: network\n  name: 網路\n  require_raw: false\n',
    'utf8',
  );
  const specs: CardSpec[] = [
    { id: 'sec-0001', category: 'security', title: '同源政策', level: 0 },
    { id: 'sec-0002', category: 'security', title: '同源政策的例外', level: 1, parent: 'sec-0001', prereqs: ['sec-0001', 'lang-0001'] },
    { id: 'sec-0003', category: 'security', title: '跨來源請求', level: 1, parent: 'sec-0001', prereqs: ['sec-0001'] },
    { id: 'lang-0001', category: 'language', title: '詞類', level: 0 },
    { id: 'lang-0002', category: 'language', title: '時態', level: 0 },
    { id: 'net-0001', category: 'network', title: '封包', level: 0 },
  ];
  for (const spec of specs) writeCard(vault, spec);
  for (const id of ['lang-0001', 'lang-0002', 'net-0001']) writeQuestions(vault, id);
  ensureCards(vault, 3); // sec-0001..3 的考題(fixture 原有的)
  writeDeps(vault, {
    security: { nodes: ['sec-0001', 'sec-0002', 'sec-0003'], edges: [['sec-0001', 'sec-0002'], ['lang-0001', 'sec-0002'], ['sec-0001', 'sec-0003']] },
    language: { nodes: ['lang-0001', 'lang-0002'], edges: [] },
    network: { nodes: ['net-0001'], edges: [] },
  });
  writeOrderFile(vault, 'security', SECURITY_ORDER);
  writeOrderFile(vault, 'language', LANGUAGE_ORDER);
  writeReviews(vault, {});
  writeFileSync(join(vault.dir, 'state/log.jsonl'), '', 'utf8');
  return vault;
}

/** 設定檔再加一個類別(原文的 peach:require_raw false)。不建它的 raw 資料夾。 */
export function addPeachCategory(vault: Vault): void {
  const path = join(vault.dir, 'config/categories.yaml');
  writeFileSync(path, `${readFileSync(path, 'utf8')}- id: peach\n  name: 桃子\n  require_raw: false\n`, 'utf8');
}

/** 這幾張卡已經學過(學過日 day):就是排程的「學過」轉移,跟側車記的一樣。 */
export function seedLearned(vault: Vault, ids: string[], day: string = TODAY): void {
  const reviews: Record<string, ReviewRecord> = existsReviews(vault) ? readReviews(vault) : {};
  for (const id of ids) reviews[id] = applyLearnedTransition({ card: id, learnedAt: day }) as unknown as ReviewRecord;
  writeReviews(vault, reviews);
}

function existsReviews(vault: Vault): boolean {
  try {
    readFileSync(join(vault.dir, 'state/reviews.json'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 已經有子卡:level 2、parent 是 `parent`、考題檔都在、圖有 parent → 子卡的邊。回傳子卡 id。 */
export function addChildren(vault: Vault, parent: string, ids: string[]): string[] {
  const depsPath = join(vault.dir, 'graph/deps.json');
  const deps = JSON.parse(readFileSync(depsPath, 'utf8')) as Record<string, Graph>;
  const graph = deps['security']!;
  ids.forEach((id, i) => {
    writeCard(vault, { id, category: 'security', title: `子卡${i + 1}`, level: 2, parent, prereqs: [parent] });
    writeQuestions(vault, id);
    graph.nodes.push(id);
    graph.edges.push([parent, id]);
  });
  mkdirSync(join(vault.dir, 'graph'), { recursive: true });
  writeFileSync(depsPath, `${JSON.stringify(deps, null, 2)}\n`, 'utf8');
  return ids;
}

// ---------------------------------------------------------------- 觀測

export function readOrder(vault: Vault, category: string): string[] {
  return JSON.parse(readFileSync(join(vault.dir, 'graph', `order-${category}.json`), 'utf8')) as string[];
}

export function readGraphs(vault: Vault): Record<string, Graph> {
  return JSON.parse(readFileSync(join(vault.dir, 'graph/deps.json'), 'utf8')) as Record<string, Graph>;
}

/**
 * order 檔違反的邊。**只看兩端都在 order 檔裡的邊**:跨類別那條的起點(別類別的卡)不在這個類別的 order 檔裡,不算。
 * 回傳空陣列 = 每條要看的邊,起點都排在終點前面。
 */
export function topologicalViolations(order: string[], graphs: Record<string, Graph>): string[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const out: string[] = [];
  for (const [category, graph] of Object.entries(graphs)) {
    for (const [from, to] of graph.edges) {
      const a = at.get(from);
      const b = at.get(to);
      if (a === undefined || b === undefined) continue;
      if (a >= b) out.push(`${category}: ${from} → ${to}`);
    }
  }
  return out;
}

/** 真的 lint(runChecks(scanDir(根))):每一種問題各幾筆,加兩種狀態各幾筆。 */
export function lintNumbers(vault: Vault): Record<LintProblemType | 'stale' | 'source_missing', number> {
  const result = lint(vault.dir);
  const out: Record<string, number> = {
    body_over_limit: 0,
    missing_questions: 0,
    orphan_questions: 0,
    missing_prereq: 0,
    orphan_child: 0,
    cycle: 0,
    prereq_mismatch: 0,
    review_orphan: 0,
    invalid_category: 0,
    stale: 0,
    source_missing: 0,
  };
  for (const p of result.problems) out[p.type] = (out[p.type] ?? 0) + 1;
  for (const s of result.statuses) out[s.type] = (out[s.type] ?? 0) + 1;
  return out as Record<LintProblemType | 'stale' | 'source_missing', number>;
}

/** 終端機那一邊:真的 `review.ts --dry-run --today <day>`,依序回到期的卡 id。 */
export async function terminalDueCards(vault: Vault, day: string): Promise<{ cards: string[]; output: string }> {
  const out = await runReview(vault, { today: day, args: ['--dry-run'] });
  if (out.status !== 0) throw new Error(`review.ts --dry-run 失敗(${out.status}):\n${out.output}`);
  const cards = out.stdout
    .split('\n')
    .map((l) => /^([a-z]+-\d{4})\s+stage\s+\d/.exec(l)?.[1])
    .filter((id): id is string => id !== undefined);
  return { cards, output: out.stdout };
}

// ---------------------------------------------------------------- 視窗

const nap = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Invoke {
  cmd: string;
  args: Record<string, unknown>;
  refused: boolean;
}

export interface TeachView {
  state: string;
  category: string | undefined;
  card: { id: string; path: string; title: string } | undefined;
  cardText: string | undefined;
  prereqs: { id: string; title: string }[];
  from: { id: string; title: string } | undefined;
  generating: boolean;
  deepenError: string | undefined;
}

export interface TeachSession {
  view(): TeachView;
  open(): Promise<void>;
  next(): Promise<void>;
  deepen(): Promise<void>;
  openCategories(): void;
  chooseCategory(id: string): Promise<void>;
}

export interface I4Window {
  sidecar: Sidecar;
  client: ReviewClient;
  /** webview 的 LearningFs 叫過的 command(read / list / exists…),`refused` 是 Rust 那邊有沒有拒絕 */
  invokes: Invoke[];
  /** 假網路收到的模型請求(到達當下記一行);沒有請求是空陣列 */
  requests(): { via: string; kind: string; card?: string; title?: string }[];
  close(): void;
}

export interface OpenOpts {
  today: string;
  /** 加在側車子行程環境上(FAKE_DEEPEN_*) */
  env?: Record<string, string | undefined>;
}

/** 起真的側車、接真的 client、webview 的 LearningFs 走 lc-fs probe。 */
export async function openWindow(vault: Vault, opts: OpenOpts): Promise<I4Window & { fs: WebviewLearningFs }> {
  const reqLog = join(vault.scratch, `requests-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
  writeFileSync(reqLog, '', 'utf8');
  const sidecar = spawnSidecar(vault, {
    today: opts.today,
    fakeCloud: FAKE_DEEPEN,
    env: { GATEWAY_API_KEY: 'fake-gateway-key', GATEWAY_BASE_URL: 'https://gateway.invalid', FAKE_DEEPEN_REQUEST_LOG: reqLog, ...(opts.env ?? {}) },
  });
  const hello = await sidecar.nextLine(60_000);
  if (!hello) throw new Error(`側車沒有在 60 秒內送出 hello(stderr:${sidecar.stderr().slice(-400)})`);
  const client = createReviewClient({
    handler: async (line: string) => {
      sidecar.writeRaw(`${line}\n`);
      const reply = await sidecar.nextLine(120_000);
      if (reply === undefined) throw new Error(`側車沒有回應(stderr:${sidecar.stderr().slice(-400)})`);
      return reply;
    },
  });
  const mod = await loadWebviewLearningFs();
  const invokes: Invoke[] = [];
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const path = cmd === 'list' ? args['relDir'] : args['relPath'];
    if (typeof path !== 'string') throw new Error(`invoke(${cmd}) 要有字串路徑參數:${JSON.stringify(args)}`);
    const body: Record<string, unknown> = { op: cmd, path };
    if (cmd === 'write') body['content'] = args['content'];
    // learning 根目錄只經指標檔(不給 root):標記跟側車看到的是同一個
    const run = runProbe(body, undefined, { env: { XDG_CONFIG_HOME: vault.xdgConfig, HOME: vault.home } });
    invokes.push({ cmd, args, refused: run.resp.refused });
    if (run.resp.error) throw run.resp.error;
    return run.resp.value ?? null;
  };
  const fs = mod.createLearningFs({ invoke, os: 'linux' });
  return {
    sidecar,
    client,
    fs,
    invokes,
    requests: () =>
      readFileSync(reqLog, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { via: string; kind: string; card?: string; title?: string }),
    close: () => sidecar.kill(),
  };
}

const SESSION_URL = new URL('../../apps/teach-card/src/teach-session.ts', import.meta.url).href;

/** 教學卡視窗:createTeachSession(真 client、LearningFs 走 lc-fs)。 */
export async function openTeachWindow(vault: Vault, opts: OpenOpts): Promise<I4Window & { session: TeachSession }> {
  const win = await openWindow(vault, opts);
  const mod = (await import(/* @vite-ignore */ SESSION_URL)) as { createTeachSession(deps: Record<string, unknown>): TeachSession };
  const store = new Map<string, string>();
  const session = mod.createTeachSession({
    client: win.client,
    fs: win.fs,
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    pause: (ms: number) => nap(Math.min(ms, 40)),
  });
  return { ...win, session };
}

/** 考試卡視窗:TestSession(真 client、LearningFs 走 lc-fs)。 */
export async function openTestWindow(vault: Vault, opts: OpenOpts): Promise<I4Window & { session: Session }> {
  const win = await openWindow(vault, opts);
  const session = await makeSession(win.client, win.fs);
  return { ...win, session };
}
