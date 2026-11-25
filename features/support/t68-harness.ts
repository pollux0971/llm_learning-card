/**
 * T68(07-teach-card phase-6,問 AI)紅測試的共用佈置與觀測。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T68-teach-ask-core-sidecar.md。規格:features/07-teach-card/phase-6.feature、ADR-086、契約 §7(1.6.0)。
 *
 * 只有「佈置」與「觀測」,沒有問答的邏輯:不組提示、不判斷建議、不算 highlight。預期值由測試自己從工單寫死。
 * 純輔助模組(沒有 vitest / cucumber 相依):vitest 與步驟檔都 import 它。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,見 review-session-harness.ts),不碰真的 learning/,不准 live。
 *
 * 世界:沿用 T43 的 `createDeepenVault`(類別順序 security、network)——
 *   security:sec-0001 level 0 學過;sec-0002 level 1(`teach.open` 之後顯示的是它);sec-0003 level 1(下一張);
 *   network:net-0001、net-0002。`children: 2` → sec-0004、sec-0005(level 2,parent sec-0002);`chain: true` → 一路到 sec-0006(level 4,最深一層)。
 *
 * 假 router(`FakeAskRouter`,程序內):task 是 `teach.ask` 的呼叫記進 `asks`(task、prompt、opts)、依腳本回答、可以在回去之前被攔住;
 * 別的 task(深入用的 children / questions)交給 T43 的 `FakeDeepenRouter`(`rig.router`)。
 *
 * 回應的形狀(工單第 4 點):
 *   `teach.ask`      → result = { asking: true }(馬上回,不等回答)
 *   `teach.ask.poll` → 進行中 result = { asking: true };完成 result 帶 `ask`(可以接在 TeachView 後面):
 *       ask = { answer, provisional, suggestion: 'continue'|'deepen'|'back'|'none', highlight: 'next'|'deepen'|{ prereq }|null, followups: string[] }
 *           | { error: 'unreadable'|'no-model'|'budget'|'failed', message }
 *   工單沒說「到上限」「沒有模型」這類失敗是在 `teach.ask` 當下就回、還是要輪詢才拿到,所以量尺用 `askFull`:兩條路都接受。
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeDeepenRouter, createDeepenVault, deepRig, type DeepenVaultOpts, type Obj, type Rig, type RigOpts } from './t43-harness.js';
import { TODAY, type Vault } from './review-session-harness.js';

export { TODAY };
export type { Obj, Vault };

export const PARENT = 'sec-0002';
export const PARENT_TITLE = '同源政策的例外';
export const AFTER_PARENT = 'sec-0003';
export const AFTER_PARENT_TITLE = '跨來源請求';
export const LEARNED_PREREQ_TITLE = '同源政策';
/** createDeepenVault 的卡:body 是「<標題>的內文。」 */
export const bodyOf = (title: string): string => `${title}的內文。`;

// ---------------------------------------------------------------- 回答

export interface AnswerOver {
  answer?: unknown;
  suggestion?: unknown;
  followups?: unknown;
  [extra: string]: unknown;
}

/** 一個合法的模型回答(JSON 文字):三個欄位,不多。 */
export function askAnswer(over: AnswerOver = {}): string {
  return JSON.stringify({ answer: '因為清單已經排好了。', suggestion: 'continue', followups: [], ...over });
}

/** 壞掉的模型回答(全都不是合法的回答):每一種的名字就是測試標題。 */
export const BAD_ANSWERS: [name: string, text: string][] = [
  ['不是 JSON(純文字)', '好的,繼續下一張。'],
  ['空字串', ''],
  ['只有空白', '   \n  '],
  ['JSON 切到一半', '{"answer":"因為清單已經排好了。","suggestion":"conti'],
  ['JSON 外面有字', `好的,這是答案:${askAnswer()}`],
  ['JSON 外面有字(後面)', `${askAnswer()}\n以上。`],
  ['用 markdown 圍欄包起來', `\`\`\`json\n${askAnswer()}\n\`\`\``],
  ['是陣列', JSON.stringify([{ answer: 'x', suggestion: 'continue', followups: [] }])],
  ['是字串', JSON.stringify('continue')],
  ['是 null', 'null'],
  ['缺 answer', JSON.stringify({ suggestion: 'continue', followups: [] })],
  ['缺 suggestion', JSON.stringify({ answer: 'x', followups: [] })],
  ['缺 followups', JSON.stringify({ answer: 'x', suggestion: 'continue' })],
  ['多一個欄位(highlight)', askAnswer({ highlight: 'next' })],
  ['多一個欄位(模型自己給先備 id)', askAnswer({ suggestion: 'back', prereq: 'sec-0003' })],
  ['suggestion 不是三選一(next)', askAnswer({ suggestion: 'next' })],
  ['suggestion 是 none(那只有側車能回)', askAnswer({ suggestion: 'none' })],
  ['suggestion 大小寫不對', askAnswer({ suggestion: 'Continue' })],
  ['suggestion 不是字串', askAnswer({ suggestion: 1 })],
  ['followups 有 4 個', askAnswer({ followups: ['a', 'b', 'c', 'd'] })],
  ['followups 不是陣列', askAnswer({ followups: 'a' })],
  ['followups 裡有不是字串的', askAnswer({ followups: ['a', 2] })],
  ['followups 裡有空字串', askAnswer({ followups: ['a', ''] })],
  ['answer 是空字串', askAnswer({ answer: '' })],
  ['answer 不是字串', askAnswer({ answer: 5 })],
];

// ---------------------------------------------------------------- 假 router

export interface AskCall {
  n: number;
  prompt: string;
  opts: Record<string, unknown> | undefined;
}

export interface AskGate {
  /** 呼叫到達之後 resolve */
  reached: Promise<AskCall>;
  release(): void;
  fail(err: Error): void;
}

/** 讓假 router「丟任何值」(字串、null、數字……),不只 Error。 */
export class ThrowValue {
  constructor(readonly value: unknown) {}
}

export class FakeAskRouter {
  /** task 是 teach.ask 的呼叫 */
  readonly asks: AskCall[] = [];
  /** 所有呼叫的 task(含別的 task),照順序 */
  readonly tasks: string[] = [];
  /** 深入、考題等別的 task 交給它;askRig 會接上 */
  inner: FakeDeepenRouter = new FakeDeepenRouter();
  /** 手上正在處理(進來了還沒回)的 ask 數 */
  inflight = 0;
  /** 每個 ask 的回應:字串、或要丟的錯、或依呼叫算 */
  reply: string | Error | ThrowValue | ((call: AskCall) => string | Error | ThrowValue) = () => askAnswer();
  /** 回的 provisional(離線走本機) */
  provisional = false;
  private gates: { promise: Promise<void>; release: () => void; fail: (e: Error) => void; reached: (c: AskCall) => void; used: boolean }[] = [];

  /** 下一個 ask 在回去之前會被攔住,直到 release / fail */
  hold(): AskGate {
    let release!: () => void;
    let rejectWith!: (e: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve;
      rejectWith = reject;
    });
    promise.catch(() => undefined);
    let reachedResolve!: (c: AskCall) => void;
    const reached = new Promise<AskCall>((resolve) => {
      reachedResolve = resolve;
    });
    this.gates.push({ promise, release, fail: rejectWith, reached: reachedResolve, used: false });
    // 呼叫一直沒到達(基底上功能還沒有)就讓測試很快失敗,不要等到整個測試逾時
    const bounded = new Promise<AskCall>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('teach.ask 的 router 呼叫沒有在 8 秒內到達')), 8000);
      void reached.then((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    bounded.catch(() => undefined);
    return { reached: bounded, release, fail: rejectWith };
  }

  async call(task: string, prompt: string, opts?: Record<string, unknown>): Promise<{ text: string; provider: string; model: string; latency_ms: number; provisional: boolean }> {
    this.tasks.push(task);
    if (task !== 'teach.ask') return await (this.inner.call(task, prompt, opts) as Promise<never>);
    const call: AskCall = { n: this.asks.length + 1, prompt, opts: opts === undefined ? undefined : { ...opts } };
    this.asks.push(call);
    this.inflight += 1;
    try {
      // 回應(或錯誤)在呼叫到達的那一刻就決定;攔住的是「回去」這一步
      const scripted = typeof this.reply === 'function' ? this.reply(call) : this.reply;
      const provisional = this.provisional;
      const gate = this.gates.find((g) => !g.used);
      if (gate) {
        gate.used = true;
        gate.reached(call);
        await gate.promise;
      }
      if (scripted instanceof ThrowValue) throw scripted.value;
      if (scripted instanceof Error) throw scripted;
      return { text: scripted, provider: provisional ? 'ollama' : 'openai', model: 'fake', latency_ms: 0, provisional };
    } finally {
      this.inflight -= 1;
    }
  }

  async probeOnline(): Promise<boolean> {
    return this.inner.online;
  }

  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return { available: this.inner.local, models: this.inner.local ? ['fake-local'] : [] };
  }
}

// ---------------------------------------------------------------- 世界與觀測

export function setPrereqs(vault: Vault, id: string, prereqs: string[], category = 'security'): void {
  const path = join(vault.dir, 'cards', category, `${id}.md`);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/^prereqs: \[.*\]$/m, `prereqs: [${prereqs.join(', ')}]`);
  if (next === text && !text.includes(`prereqs: [${prereqs.join(', ')}]`)) throw new Error(`${id} 的 prereqs 行沒換到`);
  writeFileSync(path, next, 'utf8');
}

const LEDGER = (vault: Vault): string => join(vault.dir, 'state/log.jsonl');

/** 在今天的帳本記一筆花了 `usd` 美元的 llm_call(預設單價輸出每百萬 10 美元,所以輸出 token = usd × 100000)。 */
export function seedSpend(vault: Vault, usd: number, day = TODAY): void {
  mkdirSync(join(vault.dir, 'state'), { recursive: true });
  // 帳本的 ts 要含時區;算「今天」用本地日期,所以用那天本地正午換成 UTC 字串(不管機器在哪個時區,本地日期都是 day)
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const event = { ts: new Date(y, m - 1, d, 12, 0, 0).toISOString(), type: 'llm_call', task: 'deepen', provider: 'openai', model: 'gpt-5.6-luna', latency_ms: 100, tokens_in: 0, tokens_out: Math.round(usd * 100_000) };
  appendFileSync(LEDGER(vault), `${JSON.stringify(event)}\n`, 'utf8');
}

/** 帳本多一行壞掉的字(花費變成「不知道」,不是 0)。 */
export function seedBadLedgerLine(vault: Vault): void {
  mkdirSync(join(vault.dir, 'state'), { recursive: true });
  appendFileSync(LEDGER(vault), 'this is not json\n', 'utf8');
}

export interface AskPayload {
  answer?: string;
  provisional?: boolean;
  suggestion?: string;
  highlight?: unknown;
  followups?: string[];
  error?: string;
  message?: string;
}

export const askOf = (res: Obj): AskPayload | undefined => (res['result'] as Obj | undefined)?.['ask'] as AskPayload | undefined;
export const isAsking = (res: Obj): boolean => res['ok'] === true && (res['result'] as Obj | undefined)?.['asking'] === true;
export const cardIdOf = (res: Obj): string | undefined => ((res['result'] as Obj | undefined)?.['card'] as { id?: string } | null | undefined)?.id ?? undefined;
export const kindOf = (res: Obj): string => String((res['error'] as Obj | undefined)?.['kind']);

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`逾時:${what}(${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface AskRig extends Rig {
  askRouter: FakeAskRouter;
  /** 送 teach.ask(只回第一個回應) */
  ask(question: string): Promise<Obj>;
  /** teach.ask.poll 直到不再 asking;回整個回應 */
  askDone(timeoutMs?: number): Promise<Obj>;
  /** teach.ask 然後等到結果:結果在第一個回應就有就直接回,否則輪詢;回 { first, done } */
  askFull(question: string, timeoutMs?: number): Promise<{ first: Obj; done: Obj; ask: AskPayload | undefined }>;
  /** 等 router 靜下來:ask 沒有進行中、一小段時間內沒有新呼叫 */
  settle(ms?: number): Promise<void>;
}

export type AskRigOpts = RigOpts;

export async function askRig(opts: AskRigOpts = {}): Promise<AskRig> {
  const askRouter = new FakeAskRouter();
  const rig = await deepRig({ ...opts, routerFactory: opts.routerFactory ?? (() => askRouter) });
  askRouter.inner = rig.router;
  const ask = async (question: string): Promise<Obj> => await rig.send('teach.ask', { question });
  const askDone = async (timeoutMs = 8000): Promise<Obj> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await rig.send('teach.ask.poll');
      if (!isAsking(res)) return res;
      if (Date.now() > deadline) throw new Error('teach.ask.poll 一直是 asking');
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const askFull = async (question: string, timeoutMs = 8000): Promise<{ first: Obj; done: Obj; ask: AskPayload | undefined }> => {
    const first = await ask(question);
    const done = askOf(first) !== undefined || first['ok'] !== true || !isAsking(first) ? first : await askDone(timeoutMs);
    return { first, done, ask: askOf(done) };
  };
  const settle = async (ms = 60): Promise<void> => {
    let last = -1;
    let since = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 10));
      const total = askRouter.tasks.length;
      if (askRouter.inflight > 0 || rig.router.inflight > 0 || total !== last) {
        last = total;
        since = Date.now();
        continue;
      }
      if (Date.now() - since >= ms) return;
    }
  };
  return { ...rig, askRouter, ask, askDone, askFull, settle };
}

export { createDeepenVault };
export type { DeepenVaultOpts };
