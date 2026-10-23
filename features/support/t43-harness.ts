/**
 * T43(07-teach-card phase-3,深入這個)紅測試的共用佈置與觀測。測試 agent 寫;開發 worker 不改。
 *
 * 只有「佈置」與「觀測」,沒有深入的邏輯:不排子卡、不算 level、不判斷略過。預期值由測試自己寫死。
 * 純輔助模組(沒有 vitest / cucumber 相依):vitest 與步驟檔都 import 它。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,見 review-session-harness.ts),不碰真的 learning/。
 *
 * 世界(`createDeepenVault`,類別順序 security、network):
 *
 *   security(資安,require_raw)
 *     sec-0001  level 0   學過(reviews.json 一開始就有)
 *     sec-0002  level 1   parent sec-0001,prereqs [sec-0001]      ← `teach.open` 之後顯示的就是這一張(場景背景:目前那張是 level 1)
 *     sec-0003  level 1   parent sec-0001,prereqs [sec-0001]      ← 父卡 sec-0002 之後,主流程的下一張
 *     order 檔:sec-0001, sec-0002, sec-0003(不列子卡)
 *     deps.json 的 security 圖:nodes 三張、edges [0001→0002]、[0001→0003]
 *   network(網路)
 *     net-0001, net-0002  level 0;deps.json 的 network 圖:一條邊 [0001→0002];沒有 order 檔
 *
 *   `children: 2`      → sec-0004、sec-0005(level 2,parent sec-0002;考題檔也在)
 *   `grandchildren: 2` → sec-0006、sec-0007(level 3,parent sec-0004)
 *   `chain: true`      → sec-0004(level 2,parent sec-0002)、sec-0005(level 3,parent sec-0004)、sec-0006(level 4,parent sec-0005)
 *   沒有子卡時,新配發的 id 是 sec-0004 起(`nextCardIds` 掃 cards/security/ 的最大編號加一)。
 *
 * 側車回應的形狀(T37 定,T43 多三個欄位;四個新動作也一樣):
 *   result = { category, categories, card, prereqs,
 *              from: { id, title } | null,   // 麵包屑最上層的父卡
 *              canBack: boolean,
 *              generating: boolean }
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { createVault, ledgerEvents, readReviews, removeVault, reviewRecord, reviewsPath, TODAY, writeReviews, type Vault } from './review-session-harness.js';

export { TODAY, ledgerEvents, readReviews, removeVault, reviewsPath, writeReviews };
export type { Vault };

export const TOMORROW = '2026-09-11';
export const PARENT = 'sec-0002';
export const PARENT_TITLE = '同源政策的例外';
export const AFTER_PARENT = 'sec-0003';

export interface DeepView {
  category: string;
  categories: { id: string; name: string; remaining: number; requireRaw: boolean }[];
  card: { id: string; path: string; title: string } | null;
  prereqs: { id: string; title: string }[];
  from: { id: string; title: string } | null;
  canBack: boolean;
  generating: boolean;
}

export type GraphMode = 'ok' | 'no-file' | 'no-category' | 'broken';

export interface DeepenVaultOpts {
  children?: number;
  grandchildren?: number;
  chain?: boolean;
  /** 每張 level 2 子卡的 prereqs 在父卡之外多加這些(例:['sec-0003'] → 子卡的未學先備有 sec-0003) */
  childPrereqs?: string[];
  graph?: GraphMode;
  /** 一開始就學過的卡(預設只有 sec-0001) */
  learned?: string[];
}

// ---------------------------------------------------------------- 卡片檔與考題檔

export interface CardSpec {
  id: string;
  category: string;
  title: string;
  level: number;
  parent?: string;
  prereqs?: string[];
  source?: 'raw' | 'llm';
}

export function cardText(spec: CardSpec, body = `${spec.title}的內文。`): string {
  const lines = [
    '---',
    `id: ${spec.id}`,
    `category: ${spec.category}`,
    `title: ${spec.title}`,
    `level: ${spec.level}`,
    `source: ${spec.source ?? (spec.level === 0 ? 'raw' : 'llm')}`,
    ...(spec.level === 0 ? ['source_ref: raw/security/web-basics.md#L1-L5'] : []),
    'created: 2026-09-01',
    ...(spec.parent === undefined ? [] : [`parent: ${spec.parent}`]),
    `prereqs: [${(spec.prereqs ?? []).join(', ')}]`,
    '---',
    body,
    '',
  ];
  return lines.join('\n');
}

export function writeCard(vault: Vault, spec: CardSpec): void {
  mkdirSync(join(vault.dir, 'cards', spec.category), { recursive: true });
  writeFileSync(join(vault.dir, 'cards', spec.category, `${spec.id}.md`), cardText(spec), 'utf8');
}

export const VALID_QUESTIONS = {
  fill: [
    { prompt: '同源的判定條件是 ___、___ 兩者相同。', answers: [['協定'], ['主機']] },
    { prompt: 'https://a.com 和 http://a.com 是否同源?___', answers: [['否']] },
  ],
  apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }],
};

export function writeQuestions(vault: Vault, id: string): void {
  mkdirSync(join(vault.dir, 'questions'), { recursive: true });
  writeFileSync(join(vault.dir, 'questions', `${id}.yaml`), yamlStringify({ card: id, ...VALID_QUESTIONS }), 'utf8');
}

export function writeDeps(vault: Vault, graphs: Record<string, { nodes: string[]; edges: [string, string][] }>): void {
  mkdirSync(join(vault.dir, 'graph'), { recursive: true });
  writeFileSync(join(vault.dir, 'graph/deps.json'), `${JSON.stringify(graphs, null, 2)}\n`, 'utf8');
}

export function writeOrderFile(vault: Vault, category: string, ids: string[]): void {
  mkdirSync(join(vault.dir, 'graph'), { recursive: true });
  writeFileSync(join(vault.dir, 'graph', `order-${category}.json`), `${JSON.stringify(ids)}\n`, 'utf8');
}

export function createDeepenVault(opts: DeepenVaultOpts = {}): Vault {
  const vault = createVault({ cards: 3 });
  writeFileSync(
    join(vault.dir, 'config/categories.yaml'),
    '- id: security\n  name: 資安\n  require_raw: true\n- id: network\n  name: 網路\n  require_raw: false\n',
    'utf8',
  );
  const sec: CardSpec[] = [
    { id: 'sec-0001', category: 'security', title: '同源政策', level: 0 },
    { id: 'sec-0002', category: 'security', title: PARENT_TITLE, level: 1, parent: 'sec-0001', prereqs: ['sec-0001'] },
    { id: 'sec-0003', category: 'security', title: '跨來源請求', level: 1, parent: 'sec-0001', prereqs: ['sec-0001'] },
  ];
  const nodes = ['sec-0001', 'sec-0002', 'sec-0003'];
  const edges: [string, string][] = [['sec-0001', 'sec-0002'], ['sec-0001', 'sec-0003']];
  const extra: CardSpec[] = [];
  if (opts.chain) {
    extra.push(
      { id: 'sec-0004', category: 'security', title: '第二層', level: 2, parent: 'sec-0002', prereqs: ['sec-0002'] },
      { id: 'sec-0005', category: 'security', title: '第三層', level: 3, parent: 'sec-0004', prereqs: ['sec-0004'] },
      { id: 'sec-0006', category: 'security', title: '第四層', level: 4, parent: 'sec-0005', prereqs: ['sec-0005'] },
    );
  } else {
    for (let i = 0; i < (opts.children ?? 0); i += 1) {
      const id = `sec-${String(4 + i).padStart(4, '0')}`;
      extra.push({ id, category: 'security', title: `子卡${i + 1}`, level: 2, parent: 'sec-0002', prereqs: ['sec-0002', ...(opts.childPrereqs ?? [])] });
    }
    for (let i = 0; i < (opts.grandchildren ?? 0); i += 1) {
      const id = `sec-${String(4 + (opts.children ?? 0) + i).padStart(4, '0')}`;
      extra.push({ id, category: 'security', title: `孫卡${i + 1}`, level: 3, parent: 'sec-0004', prereqs: ['sec-0004'] });
    }
  }
  for (const spec of [...sec, ...extra]) writeCard(vault, spec);
  for (const spec of extra) {
    writeQuestions(vault, spec.id);
    nodes.push(spec.id);
    edges.push([spec.parent!, spec.id]);
  }
  for (const id of ['net-0001', 'net-0002']) writeCard(vault, { id, category: 'network', title: id === 'net-0001' ? '封包' : '路由', level: 0 });

  writeOrderFile(vault, 'security', ['sec-0001', 'sec-0002', 'sec-0003']);
  const graphs = {
    security: { nodes, edges },
    network: { nodes: ['net-0001', 'net-0002'], edges: [['net-0001', 'net-0002']] as [string, string][] },
  };
  const mode = opts.graph ?? 'ok';
  const depsPath = join(vault.dir, 'graph/deps.json');
  if (mode === 'ok') writeDeps(vault, graphs);
  else if (mode === 'no-file') rmSync(depsPath, { force: true });
  else if (mode === 'no-category') writeDeps(vault, { network: graphs.network });
  else writeFileSync(depsPath, '{ this is not json', 'utf8');

  const learned = opts.learned ?? ['sec-0001'];
  const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
  for (const id of learned) reviews[id] = reviewRecord({ learned_at: TODAY, next_due: TOMORROW });
  writeReviews(vault, reviews);
  writeFileSync(join(vault.dir, 'state/log.jsonl'), '', 'utf8');
  return vault;
}

// ---------------------------------------------------------------- 觀測

function sha(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(root: string, rel: string, out: Record<string, string>): void {
  const dir = join(root, rel);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const r = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(root, r, out);
    else out[r] = sha(readFileSync(join(root, r)));
  }
}

/** `cards/`、`questions/`、`graph/` 底下每個檔的雜湊,加 `state/reviews.json`(不含 log.jsonl:那個本來就會多)。 */
export function diskHashes(vault: Vault): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sub of ['cards', 'questions', 'graph']) walk(vault.dir, sub, out);
  const reviews = join(vault.dir, 'state/reviews.json');
  if (existsSync(reviews)) out['state/reviews.json'] = sha(readFileSync(reviews));
  return out;
}

export function cardFiles(vault: Vault, category = 'security'): string[] {
  const dir = join(vault.dir, 'cards', category);
  return readdirSync(dir).filter((n) => n.endsWith('.md') && !n.endsWith('.short.md')).map((n) => n.slice(0, -3)).sort();
}

export function questionFiles(vault: Vault): string[] {
  const dir = join(vault.dir, 'questions');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.yaml')).map((n) => n.slice(0, -5)).sort() : [];
}

export function readCardText(vault: Vault, id: string, category = 'security'): string {
  return readFileSync(join(vault.dir, 'cards', category, `${id}.md`), 'utf8');
}

export function readDeps(vault: Vault): Record<string, { nodes: string[]; edges: [string, string][] }> {
  return JSON.parse(readFileSync(join(vault.dir, 'graph/deps.json'), 'utf8')) as Record<string, { nodes: string[]; edges: [string, string][] }>;
}

export function logEvents(vault: Vault, type: string): Record<string, unknown>[] {
  return ledgerEvents(vault).filter((e) => e['type'] === type);
}

/** 新配發的 id(base 世界:sec-0004 起,連號)。 */
export function newIds(n: number, from = 4): string[] {
  return Array.from({ length: n }, (_, i) => `sec-${String(from + i).padStart(4, '0')}`);
}

// ---------------------------------------------------------------- 假 router(程序內)

export interface Candidate {
  title: string;
  body: string;
  examples: string[];
}

export type CallKind = 'children' | 'regenerate' | 'questions' | 'other';

export interface RouterCall {
  n: number;
  task: string;
  kind: CallKind;
  prompt: string;
  opts: Record<string, unknown> | undefined;
  /** questions:`card:` 那行;children:`parent_id:` 那行 */
  card: string | undefined;
  title: string | undefined;
}

export interface Gate {
  /** 第一個符合的呼叫到達之後 resolve(拿到那個呼叫的紀錄) */
  reached: Promise<RouterCall>;
  /** 放行:讓那個呼叫照腳本回應 */
  release(): void;
  /** 讓那個呼叫丟錯 */
  fail(err: Error): void;
}

type Scripted<T> = T | Error | (() => T | Error);

export const SHORT_BODY = '這是一張新產生的子卡內文,說明父卡的其中一個面向。';
/** 101 個詞(英文單字用空白隔開):超過 100 字上限 */
export const LONG_BODY = Array.from({ length: 101 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');
/** 剛好 100 個詞:不超過 */
export const EXACT_BODY = Array.from({ length: 100 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');

export function candidates(n: number, body = SHORT_BODY): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({ title: `新卡${i + 1}`, body: `${body}(${i + 1})`, examples: [] }));
}

export class FakeDeepenRouter {
  readonly calls: RouterCall[] = [];
  online = true;
  local = false;
  /** 子卡那一個呼叫的回應;預設兩張 */
  children: Scripted<Candidate[] | string> = () => candidates(2);
  /** 重寫:收到(標題, 第幾次重寫);預設回短的 body */
  regenerate: (title: string, attempt: number) => Scripted<Candidate[] | string> = () => [{ title: '', body: SHORT_BODY, examples: [] }];
  /** 考題:收到(卡 id, 標題);預設合法 */
  questions: (card: string, title: string) => Scripted<string> = () => JSON.stringify(VALID_QUESTIONS);
  /** 這個呼叫回的 provisional */
  provisionalOf: (call: RouterCall) => boolean = () => false;
  private gates: { match: (c: RouterCall) => boolean; promise: Promise<void>; release: () => void; fail: (e: Error) => void; reached: (c: RouterCall) => void; used: boolean; failure?: Error }[] = [];
  /** 手上正在處理(進來了還沒回)的呼叫數 */
  inflight = 0;

  of(kind: CallKind): RouterCall[] {
    return this.calls.filter((c) => c.kind === kind);
  }

  /** 第一個符合的呼叫在回應之前會被攔住,直到 release / fail。 */
  hold(match: (c: RouterCall) => boolean): Gate {
    let release!: () => void;
    let rejectWith!: (e: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve;
      rejectWith = reject;
    });
    promise.catch(() => undefined);
    let reachedResolve!: (c: RouterCall) => void;
    const reached = new Promise<RouterCall>((resolve) => {
      reachedResolve = resolve;
    });
    this.gates.push({ match, promise, release, fail: rejectWith, reached: reachedResolve, used: false });
    // 呼叫一直沒到達(基底上功能還沒有)就讓測試很快失敗,不要等到整個測試逾時
    const bounded = new Promise<RouterCall>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('router 的呼叫沒有在 8 秒內到達')), 8000);
      void reached.then((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    bounded.catch(() => undefined);
    return { reached: bounded, release, fail: rejectWith };
  }

  async call(task: string, prompt: string, opts?: Record<string, unknown>): Promise<{ text: string; provider: string; model: string; latency_ms: number; provisional: boolean }> {
    const record = this.record(task, prompt, opts);
    this.inflight += 1;
    try {
      // 回應(或錯誤)在呼叫到達的那一刻就依當時的腳本決定;攔住的是「回去」這一步,所以腳本之後再改也不影響已經在途中的呼叫
      let text = '';
      let failure: Error | undefined;
      try {
        text = this.reply(record);
      } catch (err) {
        failure = err as Error;
      }
      const provisional = this.provisionalOf(record);
      const gate = this.gates.find((g) => !g.used && g.match(record));
      if (gate) {
        gate.used = true;
        gate.reached(record);
        await gate.promise;
      }
      if (failure) throw failure;
      return { text, provider: provisional ? 'ollama' : 'openai', model: 'fake', latency_ms: 0, provisional };
    } finally {
      this.inflight -= 1;
    }
  }

  async probeOnline(): Promise<boolean> {
    return this.online;
  }

  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return { available: this.local, models: this.local ? ['fake-local'] : [] };
  }

  private record(task: string, prompt: string, opts?: Record<string, unknown>): RouterCall {
    const kind: CallKind = task.startsWith('grade.') || task.startsWith('reteach.') ? 'other' : prompt.includes('previous body:') ? 'regenerate' : prompt.includes('parent_id:') ? 'children' : /^card:\s*\S+$/m.test(prompt) ? 'questions' : 'other';
    const card = kind === 'children' ? /^parent_id:\s*(\S+)$/m.exec(prompt)?.[1] : kind === 'questions' ? /^card:\s*(\S+)$/m.exec(prompt)?.[1] : undefined;
    const title = kind === 'regenerate' || kind === 'questions' ? /^title:\s*(.+)$/m.exec(prompt)?.[1]?.trim() : undefined;
    const rec: RouterCall = { n: this.calls.length + 1, task, kind, prompt, opts: opts === undefined ? undefined : { ...opts }, card, title };
    this.calls.push(rec);
    return rec;
  }

  private reply(call: RouterCall): string {
    const run = <T>(s: Scripted<T>): T => {
      const v = typeof s === 'function' ? (s as () => T | Error)() : s;
      if (v instanceof Error) throw v;
      return v;
    };
    const toText = (v: Candidate[] | string): string => (typeof v === 'string' ? v : JSON.stringify(v));
    if (call.kind === 'children') return toText(run(this.children));
    if (call.kind === 'regenerate') {
      const attempt = this.calls.filter((c) => c.kind === 'regenerate' && c.title === call.title && c.n <= call.n).length;
      return toText(run(this.regenerate(call.title ?? '', attempt)));
    }
    if (call.kind === 'questions') return run(this.questions(call.card ?? '', call.title ?? ''));
    if (call.task === 'grade.apply') return scriptedApplyReply(call.prompt);
    if (call.task === 'grade.fill.llm') return 'no';
    throw new Error(`FakeDeepenRouter 沒有預期到的呼叫(${call.task}):${call.prompt.slice(0, 80)}`);
  }
}

/** 一個沒有金鑰問題的 env;`LLM_CLOUD_PROVIDER=openai` → 缺或被拒絕的鍵名是 OPENAI_API_KEY。 */
export { childEnv } from './review-session-harness.js';

// ---------------------------------------------------------------- 側車 handler 的接法

import { pathToFileURL } from 'node:url';
import { childEnv as baseChildEnv } from './review-session-harness.js';

const HANDLER_URL = pathToFileURL(join(import.meta.dirname, '../../packages/core/src/session/handler.ts')).href;

export type Obj = Record<string, unknown>;
type Handler = (line: string) => Promise<string>;

export interface RigOpts extends DeepenVaultOpts {
  /** 給 handler 的 routerFactory;預設回 rig.router */
  routerFactory?: () => unknown;
  /** 缺的鍵名(給 handler 的 missingKeys) */
  missingKeys?: () => readonly string[];
  /** 重讀 .env,回內容有沒有變 */
  reloadEnv?: () => boolean;
  /** 在 router 建好之後、handler 建好之前改腳本 */
  setup?: (router: FakeDeepenRouter) => void;
  /** 蓋掉 childEnv 的鍵 */
  env?: Record<string, string | undefined>;
}

export interface Rig {
  v: Vault;
  router: FakeDeepenRouter;
  send(method: string, params?: Obj): Promise<Obj>;
  /** 成功的 teach.* → result */
  view(method: string, params?: Obj): Promise<DeepView>;
  /** teach.poll 直到不再 generating(成功、失敗、或沒有工作都算);回整個回應 */
  pollDone(timeoutMs?: number): Promise<Obj>;
  /** 等 router 靜下來:沒有進行中的呼叫,而且一小段時間內沒有新呼叫 */
  quiet(ms?: number): Promise<void>;
}

const vaultsToClean: Vault[] = [];
export function cleanupRigs(): void {
  for (const v of vaultsToClean.splice(0)) removeVault(v);
}

export async function deepRig(opts: RigOpts = {}): Promise<Rig> {
  const v = createDeepenVault(opts);
  vaultsToClean.push(v);
  const router = new FakeDeepenRouter();
  opts.setup?.(router);
  const mod = (await import(/* @vite-ignore */ HANDLER_URL)) as { createReviewHandler(deps: Obj): Handler };
  const handler = mod.createReviewHandler({
    learningDir: v.dir,
    today: TODAY,
    routerFactory: opts.routerFactory ?? (() => router),
    env: baseChildEnv(v, opts.env ?? {}),
    ...(opts.missingKeys ? { missingKeys: opts.missingKeys } : {}),
    ...(opts.reloadEnv ? { reloadEnv: opts.reloadEnv } : {}),
  });
  let id = 0;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => {
    id += 1;
    return JSON.parse(await handler(JSON.stringify({ v: 1, id, method, params }))) as Obj;
  };
  const view = async (method: string, params: Obj = {}): Promise<DeepView> => {
    const res = await send(method, params);
    if (res['ok'] !== true) throw new Error(`${method} 應該成功:${JSON.stringify(res)}`);
    return res['result'] as unknown as DeepView;
  };
  const pollDone = async (timeoutMs = 8000): Promise<Obj> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await send('teach.poll');
      const generating = res['ok'] === true && (res['result'] as DeepView).generating === true;
      if (!generating) return res;
      if (Date.now() > deadline) throw new Error('teach.poll 一直是 generating');
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const quiet = async (ms = 60): Promise<void> => {
    let last = -1;
    let since = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 10));
      if (router.inflight > 0 || router.calls.length !== last) {
        last = router.calls.length;
        since = Date.now();
        continue;
      }
      if (Date.now() - since >= ms) return;
    }
  };
  return { v, router, send, view, pollDone, quiet };
}

export const errorKind = (res: Obj): string => String((res['error'] as Obj | undefined)?.['kind']);
export const errorMessage = (res: Obj): string => String((res['error'] as Obj | undefined)?.['message']);
export const resultOf = (res: Obj): DeepView => res['result'] as unknown as DeepView;
