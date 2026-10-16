/**
 * T26 · 寫 `state/reviews.json` 之前先確認它沒被別人改過(樂觀檢查,不加鎖)。
 *
 * 規格:`docs/tickets/T26-reviews-optimistic-check.md`(要求 1–4、6,「載入時到底指哪一次」那張表)。
 * 終端機那一段(要求 5)在 `features/support/reviews-changed-cli.test.ts` 與 `features/11-review-cli/phase-3.feature`。
 *
 * 這支測試寫在實作之前:`readReviewsSnapshot`、`saveReviewsIfUnchanged`、`ReviewsChangedError` 與 `Session.reviewsHash`
 * 還不存在,所以從 `io.ts` 的 namespace 取、型別用本檔的介面轉(tsc 照樣乾淨);取不到就以「還沒有這個函式」紅,不是測試自己壞掉。
 *
 * 一律暫存目錄(`contracts/fixtures/learning-minimal` 的複本),不碰真的 learning/;填空題用精確答案,不會呼叫 router。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review } from '@contracts/index.js';
import type { LlmResult, LlmRouter } from '@core/grading/index.js';
import * as atomic from '@core/schema/atomic-write.js';
import * as io from './io.js';
import * as sessionIndex from './index.js';
import { submitAnswer } from './answer.js';
import { buildTodaySession } from './build.js';
import { presentNextCard } from './present.js';
import type { Session } from './types.js';

vi.mock('@core/schema/atomic-write.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/atomic-write.js')>();
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic) };
});

const ROOT = resolve(import.meta.dirname, '../../../..');
const TEMPLATE = join(ROOT, 'contracts/fixtures/learning-minimal');
const TODAY = '2026-09-10';
const MESSAGE = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';
const CODE = 'reviews-changed';

// ---------------------------------------------------------------- 還沒寫的 API(T26 要求 2、3)

type ReviewsMap = Record<string, Review>;
type ChangedError = Error & { code: string };
interface IoT26 {
  readReviewsSnapshot?: (learningDir: string) => { reviews: ReviewsMap; hash: string };
  saveReviewsIfUnchanged?: (learningDir: string, reviews: ReviewsMap, expectedHash: string) => string;
  ReviewsChangedError?: new (...args: never[]) => ChangedError;
}
const t26 = io as unknown as IoT26;

function need<K extends keyof IoT26>(name: K): NonNullable<IoT26[K]> {
  const value = t26[name];
  if (value === undefined) throw new Error(`packages/core/src/session/io.ts 還沒有匯出 ${name}(T26 要求 2)`);
  return value as NonNullable<IoT26[K]>;
}

function hashOf(session: Session): string | undefined {
  return (session as Session & { reviewsHash?: string }).reviewsHash;
}

// ---------------------------------------------------------------- 暫存目錄與資料

const dirs: string[] = [];
beforeEach(() => {
  vi.mocked(atomic.writeFileAtomic).mockClear();
});
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function learningDir(): string {
  const scratch = mkdtempSync(join(tmpdir(), 'lc-t26-'));
  dirs.push(scratch);
  const dir = join(scratch, 'learning');
  cpSync(TEMPLATE, dir, { recursive: true });
  return dir;
}

function reviewsFile(dir: string): string {
  return join(dir, 'state/reviews.json');
}

function bytes(dir: string): Buffer {
  return readFileSync(reviewsFile(dir));
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function stateNames(dir: string): string[] {
  return readdirSync(join(dir, 'state')).sort();
}

function record(over: Partial<Review> & Pick<Review, 'next_due'>): Review {
  return { stage: 1, learned_at: '2026-08-01', fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...over } as Review;
}

function writeReviewsRaw(dir: string, text: string): void {
  writeFileSync(reviewsFile(dir), text, 'utf8');
}

function writeReviews(dir: string, reviews: ReviewsMap): void {
  writeReviewsRaw(dir, `${JSON.stringify(reviews, null, 2)}\n`);
}

/** 別的地方改了 reviews.json:不在今天名單上的卡(sec-0003)多一筆舊的 history。回傳改完的位元組。 */
function changeElsewhere(dir: string): Buffer {
  const reviews = JSON.parse(bytes(dir).toString('utf8')) as ReviewsMap;
  const other = reviews['sec-0003'] ?? record({ next_due: '2026-12-31' });
  reviews['sec-0003'] = {
    ...other,
    history: [...other.history, { date: '2026-09-01', stage: other.stage, type: 'fill', pass: true, grader: 'exact' }],
  } as Review;
  writeReviews(dir, reviews);
  return bytes(dir);
}

function refusingRouter(): LlmRouter {
  const refuse = async (): Promise<never> => {
    throw new Error('填空用精確答案,不該呼叫 router');
  };
  return { call: refuse, probeOnline: refuse, probeLocal: refuse };
}

function scriptedRouter(texts: string[]): LlmRouter {
  let i = 0;
  return {
    async call(): Promise<LlmResult> {
      const text = texts[Math.min(i, texts.length - 1)]!;
      i += 1;
      return { text, provider: 'openai', model: 'fake', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

/** learning-minimal 三張卡的第一題填空,精確答案(逗號分隔,splitFillAnswer 會切開)。 */
const FILL_ANSWER: Record<string, string> = {
  'sec-0001': '協定,主機,埠號',
  'sec-0002': '伺服器',
  'sec-0003': '之前',
};

/** sec-0001、sec-0002 今天到期(stage 1,只考填空;sec-0001 逾期多,排第一);sec-0003 不到期。 */
function twoDue(dir: string): void {
  writeReviews(dir, {
    'sec-0001': record({ next_due: '2026-09-08' }),
    'sec-0002': record({ next_due: '2026-09-10' }),
    'sec-0003': record({ next_due: '2026-12-31', stage: 3 }),
  });
}

async function answerNext(session: Session): Promise<string> {
  const p = await presentNextCard(session);
  if (p.kind !== 'question') throw new Error(`預期出題,拿到 ${p.kind}`);
  await submitAnswer(session, FILL_ANSWER[p.card]!);
  return p.card;
}

function todaysHistory(dir: string, card: string): unknown[] {
  const reviews = JSON.parse(bytes(dir).toString('utf8')) as ReviewsMap;
  return (reviews[card]?.history ?? []).filter((e) => e.date === TODAY);
}

// ================================================================ 要求 1、2:readReviewsSnapshot

describe('readReviewsSnapshot(T26 要求 1、2):一次讀檔,同一份位元組既解析又算雜湊', () => {
  it('雜湊是檔案原始位元組的 SHA-256(十六進位小寫),不是重新序列化之後的', () => {
    const dir = learningDir();
    // 合法但不是 JSON.stringify(…, null, 2) 的排法:多空白、多一個結尾換行
    writeReviewsRaw(dir, `{ "sec-0001" : ${JSON.stringify(record({ next_due: TODAY }))} }\n\n`);
    const snap = need('readReviewsSnapshot')(dir);
    expect(snap.hash).toBe(sha256(bytes(dir)));
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.hash).not.toBe(sha256(`${JSON.stringify(snap.reviews, null, 2)}\n`));
  });

  it('reviews 與 loadReviews 讀到的深度相等(同樣過 ReviewSchema.parse)', () => {
    const dir = learningDir();
    twoDue(dir);
    expect(need('readReviewsSnapshot')(dir).reviews).toEqual(io.loadReviews(dir));
  });

  it("檔案不存在 → reviews 是 {}、hash 是固定的 'absent'(不是空檔的雜湊)", () => {
    const dir = learningDir();
    unlinkSync(reviewsFile(dir));
    const snap = need('readReviewsSnapshot')(dir);
    expect(snap).toEqual({ reviews: {}, hash: 'absent' });
    expect(snap.hash).not.toBe(sha256(''));
  });

  it('格式壞掉照舊丟錯,跟 loadReviews 丟同一種', () => {
    const dir = learningDir();
    writeReviewsRaw(dir, JSON.stringify({ 'sec-0001': { stage: 'not-a-stage' } }));
    let fromLoad: unknown;
    try {
      io.loadReviews(dir);
    } catch (err) {
      fromLoad = err;
    }
    expect(fromLoad, '前提:loadReviews 對這份資料會丟錯').toBeInstanceOf(Error);
    const read = need('readReviewsSnapshot');
    expect(() => read(dir)).toThrow();
    try {
      read(dir);
    } catch (err) {
      expect((err as Error).constructor.name).toBe((fromLoad as Error).constructor.name);
    }
  });
});

// ================================================================ 要求 2:saveReviewsIfUnchanged、ReviewsChangedError

describe('saveReviewsIfUnchanged(T26 要求 2):寫之前再讀一次,雜湊不同就什麼都不寫', () => {
  it('雜湊相同 → 照 saveReviews 的格式經 writeFileAtomic 寫入,回傳剛寫進去的位元組的雜湊', () => {
    const dir = learningDir();
    twoDue(dir);
    const before = sha256(bytes(dir));
    const next: ReviewsMap = { 'sec-0001': record({ next_due: '2026-09-11', stage: 2 }) };
    const returned = need('saveReviewsIfUnchanged')(dir, next, before);
    expect(bytes(dir).toString('utf8')).toBe(`${JSON.stringify(next, null, 2)}\n`);
    expect(returned).toBe(sha256(bytes(dir)));
    expect(vi.mocked(atomic.writeFileAtomic)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(atomic.writeFileAtomic).mock.calls[0]![0]).toBe(reviewsFile(dir));
  });

  it('雜湊不同 → 丟 ReviewsChangedError(訊息與 code 逐字),磁碟位元組不變、沒有暫存檔、沒有呼叫 writeFileAtomic', () => {
    const dir = learningDir();
    twoDue(dir);
    const stale = sha256(bytes(dir));
    const changed = changeElsewhere(dir);
    const names = stateNames(dir);
    const Changed = need('ReviewsChangedError');
    let caught: unknown;
    try {
      need('saveReviewsIfUnchanged')(dir, { 'sec-0001': record({ next_due: '2026-09-11' }) }, stale);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Changed);
    expect((caught as ChangedError).message).toBe(MESSAGE);
    expect((caught as ChangedError).code).toBe(CODE);
    expect(bytes(dir).equals(changed)).toBe(true);
    expect(stateNames(dir)).toEqual(names);
    expect(stateNames(dir).some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(vi.mocked(atomic.writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('內容一樣、只有排法不同也算被改過(比的是原始位元組,不是解析後的物件)', () => {
    const dir = learningDir();
    twoDue(dir);
    const stale = sha256(bytes(dir));
    const reviews = io.loadReviews(dir);
    writeReviewsRaw(dir, `${JSON.stringify(reviews)}\n`); // 同一份資料,沒有縮排
    expect(() => need('saveReviewsIfUnchanged')(dir, reviews, stale)).toThrow(MESSAGE);
  });

  it("檔案原本不存在、基準是 'absent' → 可以寫", () => {
    const dir = learningDir();
    unlinkSync(reviewsFile(dir));
    const next: ReviewsMap = { 'sec-0001': record({ next_due: TODAY }) };
    const returned = need('saveReviewsIfUnchanged')(dir, next, 'absent');
    expect(existsSync(reviewsFile(dir))).toBe(true);
    expect(returned).toBe(sha256(bytes(dir)));
  });

  it("基準是 'absent' 但別人在這期間建了檔 → 丟錯,別人的檔不動", () => {
    const dir = learningDir();
    unlinkSync(reviewsFile(dir));
    writeReviews(dir, { 'sec-0002': record({ next_due: TODAY }) });
    const theirs = bytes(dir);
    expect(() => need('saveReviewsIfUnchanged')(dir, { 'sec-0001': record({ next_due: TODAY }) }, 'absent')).toThrow(MESSAGE);
    expect(bytes(dir).equals(theirs)).toBe(true);
  });

  it('載入時有檔、寫之前被刪掉了 → 丟錯,也不替它建一個新檔', () => {
    const dir = learningDir();
    twoDue(dir);
    const stale = sha256(bytes(dir));
    unlinkSync(reviewsFile(dir));
    expect(() => need('saveReviewsIfUnchanged')(dir, { 'sec-0001': record({ next_due: TODAY }) }, stale)).toThrow(MESSAGE);
    expect(existsSync(reviewsFile(dir))).toBe(false);
  });
});

describe('ReviewsChangedError(T26 要求 2、「錯誤類別」那一列)', () => {
  it('從 io.ts 匯出,session/index.ts 也再匯出同一個類別;是 Error;訊息是一整行兩句、code 固定', () => {
    const Changed = need('ReviewsChangedError');
    expect((sessionIndex as unknown as IoT26).ReviewsChangedError).toBe(Changed);
    const err = new Changed();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(MESSAGE);
    expect(err.message).not.toContain('\n');
    expect(err.code).toBe(CODE);
  });
});

// ================================================================ 要求 3、4:session 的基準雜湊與 submitAnswer

describe('Session.reviewsHash(T26 要求 3):session 建立時記下的那一次', () => {
  it('buildTodaySession 回的 session 帶著建立當下磁碟上 reviews.json 的雜湊', async () => {
    const dir = learningDir();
    twoDue(dir);
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    expect(hashOf(session)).toBe(sha256(bytes(dir)));
  });

  it("reviews.json 不存在時是 'absent'", async () => {
    const dir = learningDir();
    unlinkSync(reviewsFile(dir));
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    expect(hashOf(session)).toBe('absent');
  });
});

describe('submitAnswer(T26 要求 4):session 建立之後被別處改過,下一次寫入就拒絕', () => {
  it('建立 session 之後、最後一題送出之前改寫磁碟 → 丟 ReviewsChangedError;磁碟還是別人的那份;queue、passed、failed 都沒動', async () => {
    const dir = learningDir();
    writeReviews(dir, { 'sec-0002': record({ next_due: TODAY }), 'sec-0003': record({ next_due: '2026-12-31', stage: 3 }) });
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    const p = await presentNextCard(session);
    expect(p.kind).toBe('question');
    const theirs = changeElsewhere(dir);
    const names = stateNames(dir);
    const queueBefore = session.queue.length;
    vi.mocked(atomic.writeFileAtomic).mockClear();

    const Changed = need('ReviewsChangedError');
    const outcome = submitAnswer(session, FILL_ANSWER['sec-0002']!);
    await expect(outcome).rejects.toBeInstanceOf(Changed);
    await expect(outcome).rejects.toMatchObject({ message: MESSAGE, code: CODE });

    expect(bytes(dir).equals(theirs)).toBe(true);
    expect(stateNames(dir)).toEqual(names);
    expect(vi.mocked(atomic.writeFileAtomic)).not.toHaveBeenCalled();
    expect(session.queue.length).toBe(queueBefore);
    expect(session.passed).toBe(0);
    expect(session.failed).toBe(0);
  });

  it('同一個 session 連答兩張:第一張寫入後基準更新成自己剛寫的,第二張不會誤報', async () => {
    const dir = learningDir();
    twoDue(dir);
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    const first = await answerNext(session);
    expect(hashOf(session)).toBe(sha256(bytes(dir)));
    const second = await answerNext(session);
    expect(hashOf(session)).toBe(sha256(bytes(dir)));
    expect([first, second].sort()).toEqual(['sec-0001', 'sec-0002']);
    expect(todaysHistory(dir, 'sec-0001')).toHaveLength(1);
    expect(todaysHistory(dir, 'sec-0002')).toHaveLength(1);
    expect(session.passed).toBe(2);
  });

  it('兩張之間有人改檔 → 第二張丟錯;第一張已經寫進去的還在', async () => {
    const dir = learningDir();
    twoDue(dir);
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    const first = await answerNext(session);
    const theirs = changeElsewhere(dir);
    const p = await presentNextCard(session);
    if (p.kind !== 'question') throw new Error('預期第二題');
    await expect(submitAnswer(session, FILL_ANSWER[p.card]!)).rejects.toThrow(MESSAGE);
    expect(bytes(dir).equals(theirs)).toBe(true);
    expect(todaysHistory(dir, first)).toHaveLength(1);
    expect(todaysHistory(dir, p.card)).toHaveLength(0);
    expect(session.passed).toBe(1);
  });

  it('第二階段的卡:第一題(partial)不寫也不檢查;第一題之後有人改檔,第二題送出時丟錯', async () => {
    const dir = learningDir();
    writeReviews(dir, { 'sec-0001': record({ next_due: '2026-09-03', stage: 2 }), 'sec-0003': record({ next_due: '2026-12-31', stage: 3 }) });
    const session = await buildTodaySession({
      learningDir: dir,
      today: TODAY,
      router: scriptedRouter([JSON.stringify({ criteria: [true, true, true], feedback: '涵蓋重點' })]), // sec-0001 的應用題有三條 rubric
    });
    const fill = await presentNextCard(session);
    expect(fill).toMatchObject({ kind: 'question', type: 'fill' });
    const partial = await submitAnswer(session, FILL_ANSWER['sec-0001']!);
    expect(partial.status).toBe('partial');
    const theirs = changeElsewhere(dir);
    const apply = await presentNextCard(session);
    expect(apply).toMatchObject({ kind: 'question', type: 'apply' });
    // 前提:沒有人改檔時這一題會通過(批改本身不是 error),紅只能來自衝突偵測 —— 見下一條「防退步」
    await expect(submitAnswer(session, '這是跨來源請求,要伺服器設定允許的來源。')).rejects.toThrow(MESSAGE);
    expect(bytes(dir).equals(theirs)).toBe(true);
    expect(session.passed).toBe(0);
  });

  it('防退步(上一條的前提):同一張第二階段的卡、中間沒有人改檔 → 兩題都過、寫入一次', async () => {
    const dir = learningDir();
    writeReviews(dir, { 'sec-0001': record({ next_due: '2026-09-03', stage: 2 }), 'sec-0003': record({ next_due: '2026-12-31', stage: 3 }) });
    const session = await buildTodaySession({
      learningDir: dir,
      today: TODAY,
      router: scriptedRouter([JSON.stringify({ criteria: [true, true, true], feedback: '涵蓋重點' })]),
    });
    await presentNextCard(session);
    expect((await submitAnswer(session, FILL_ANSWER['sec-0001']!)).status).toBe('partial');
    await presentNextCard(session);
    const done = await submitAnswer(session, '這是跨來源請求,要伺服器設定允許的來源。');
    expect(done.status).toBe('passed');
    expect(todaysHistory(dir, 'sec-0001')).toHaveLength(2);
  });

  it('批改失敗(hadError)那條本來就不寫:就算有人改過檔,也照舊回 error、不丟 ReviewsChangedError、不寫', async () => {
    const dir = learningDir();
    writeReviews(dir, { 'sec-0003': record({ next_due: '2026-09-01', stage: 3 }), 'sec-0002': record({ next_due: '2026-12-31' }) });
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: scriptedRouter(['不是 JSON']) });
    const p = await presentNextCard(session);
    expect(p).toMatchObject({ kind: 'question', type: 'apply' });
    const theirs = (() => {
      const reviews = JSON.parse(bytes(dir).toString('utf8')) as ReviewsMap;
      reviews['sec-0002'] = { ...reviews['sec-0002']!, total_fails: 1 } as Review;
      writeReviews(dir, reviews);
      return bytes(dir);
    })();
    vi.mocked(atomic.writeFileAtomic).mockClear();
    const outcome = await submitAnswer(session, '隨便寫');
    expect(outcome.status).toBe('error');
    expect(bytes(dir).equals(theirs)).toBe(true);
    expect(vi.mocked(atomic.writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('reviewsHash 沒設(手工組的 session)→ 跟現在一樣,不丟錯;寫回的檔保留別人的改動', async () => {
    const dir = learningDir();
    twoDue(dir);
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    delete (session as Session & { reviewsHash?: string }).reviewsHash;
    const p = await presentNextCard(session);
    if (p.kind !== 'question') throw new Error('預期出題');
    changeElsewhere(dir);
    const outcome = await submitAnswer(session, FILL_ANSWER[p.card]!);
    expect(outcome.status).toBe('passed');
    const reviews = JSON.parse(bytes(dir).toString('utf8')) as ReviewsMap;
    expect(reviews['sec-0003']!.history.some((e) => e.date === '2026-09-01')).toBe(true);
    expect(todaysHistory(dir, p.card)).toHaveLength(1);
  });

  it('寫入走 saveReviewsIfUnchanged → writeFileAtomic,每張卡剛好一次', async () => {
    const dir = learningDir();
    twoDue(dir);
    const session = await buildTodaySession({ learningDir: dir, today: TODAY, router: refusingRouter() });
    vi.mocked(atomic.writeFileAtomic).mockClear();
    await answerNext(session);
    await answerNext(session);
    const calls = vi.mocked(atomic.writeFileAtomic).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([reviewsFile(dir), reviewsFile(dir)]);
  });
});

// ================================================================ 靜態:兩個建 session 的地方、不加鎖、不新增檔案

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function functionBody(code: string, name: string): string {
  const at = code.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (at < 0) return '';
  const open = code.indexOf('{', code.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return '';
}

describe('靜態(T26 要求 3、6、must_catch 最後一條)', () => {
  // T22 改動(工單驗收 1「編排只有一份」強制):sessionFromCache 從 scripts/review.ts 搬進 packages/core/src/session/engine.ts,
  // 所以這條斷言的檔案跟著換;斷言本身一個字沒放鬆(仍要 readReviewsSnapshot 與 reviewsHash)。
  it('engine.ts 的 sessionFromCache(續答那條建 session 的路)用 readReviewsSnapshot 並把雜湊放進 session', () => {
    const body = functionBody(source('packages/core/src/session/engine.ts'), 'sessionFromCache');
    expect(body, '找不到 sessionFromCache').not.toBe('');
    expect(body).toMatch(/readReviewsSnapshot\s*\(/);
    expect(body).toMatch(/reviewsHash\s*:/);
  });

  it('build.ts 的 buildTodaySession 用 readReviewsSnapshot 讀,不再用 loadReviews', () => {
    const body = functionBody(source('packages/core/src/session/build.ts'), 'buildTodaySession');
    expect(body).toMatch(/readReviewsSnapshot\s*\(/);
    expect(body).not.toMatch(/\bloadReviews\s*\(/);
    expect(body).toMatch(/reviewsHash/);
  });

  it('answer.ts 寫 reviews.json 只經 saveReviewsIfUnchanged,不再直接呼叫 saveReviews', () => {
    const code = source('packages/core/src/session/answer.ts');
    expect(code).toMatch(/saveReviewsIfUnchanged\s*\(/);
    expect(code).not.toMatch(/\bsaveReviews\s*\(/);
  });

  it('不加鎖:io.ts、answer.ts、build.ts 沒有鎖檔、flock、O_EXCL 之類的寫法;io.ts 不用 writeFileSync 寫 reviews', () => {
    for (const rel of ['packages/core/src/session/io.ts', 'packages/core/src/session/answer.ts', 'packages/core/src/session/build.ts']) {
      const code = source(rel);
      expect(code, rel).not.toMatch(/flock|lockfile|\.lock\b|O_EXCL|['"]wx['"]/);
    }
    expect(source('packages/core/src/session/io.ts')).not.toMatch(/\bwriteFileSync\s*\(/);
  });
});
