/**
 * T24 驗收 2(「程序內跑真的 core」那一列)、驗收 4 的真實錯誤:
 * `TestSession` ← `createReviewClient({ handler: createReviewHandler(…) })` ← 暫存根(learning-minimal 複本)。
 * 紅測試作者寫;開發 worker 不改。路由器是程序內的假物件,不打網路;全部用 mkdtemp,不碰真的 learning/。
 *
 * 對應 phase-2.feature 的四個場景(同樣的事,cucumber 版在 features/steps/test-card-phase2.steps.ts):
 * the real scheduler 的清單與順序、答案馬上落地、視窗與終端機同一份、批改失敗不動卡片。
 * 另外固定:真的 reteach(有 / 沒有縮短版)、真的 review-record-changed、真的暫停與 0 張卡、做完的 summary。
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDay, pauseDay } from '../../packages/core/src/session/engine.js';
import {
  DEFAULT_FIVE,
  DEFAULT_FIVE_ORDER,
  TODAY,
  answerCurrent,
  createRig,
  fakeRouter,
  walkToEnd,
  type Rig,
} from './test-card-rig.js';
import { headMessage, readReviews, reviewsPath } from './review-session-harness.js';

const rigs: Rig[] = [];
afterAll(() => {
  for (const r of rigs) r.dispose();
});
async function rig(opts: Parameters<typeof createRig>[0] = {}): Promise<Rig> {
  const r = await createRig(opts);
  rigs.push(r);
  return r;
}

describe('真的 scheduler 的清單與順序(場景 The card shows exactly what the real scheduler returns)', () => {
  it('五張到期卡:依 04 的順序(逾期多的在前)一張一張出現,header 的已答跟著走,最後 done', async () => {
    const r = await rig();
    await r.session.init();
    const headers: number[] = [];
    const cards: string[] = [];
    for (let i = 0; i < 20 && r.session.getView().state === 'question'; i += 1) {
      const v = r.session.getView();
      if (cards[cards.length - 1] !== v.current!.card) {
        cards.push(v.current!.card);
        headers.push(v.answeredCount);
        expect(v.totalCount).toBe(5);
      }
      await answerCurrent(r.session);
      await r.session.next();
    }
    expect(cards).toEqual(DEFAULT_FIVE_ORDER);
    expect(headers).toEqual([0, 1, 2, 3, 4]);
    expect(r.session.getView().state).toBe('done');
  });

  it('題目文字是側車給的(題幹有 [卡 id] 前綴);填空格數 = 該題的空格數', async () => {
    const r = await rig();
    await r.session.init();
    const cur = r.session.getView().current!;
    expect(cur.card).toBe('sec-0001');
    expect(cur.type).toBe('fill');
    expect(cur.prompt).toContain('[sec-0001]');
    expect(cur.blanks).toBe((cur.prompt.match(/___/g) ?? []).length);
    expect(cur.overdueDays).toBe(5);
  });

  it('跟 core 同一份:同一個暫存根上,終端機那條路(openDay)排出來的第一張卡跟視窗第一題相同', async () => {
    const r = await rig();
    const opened = await openDay({ learningDir: r.vault.dir, today: TODAY, router: fakeRouter() as never, env: r.env });
    if (opened.kind !== 'ready') throw new Error(`openDay 回 ${opened.kind}`);
    await r.session.init();
    expect(r.session.getView().current!.card).toBe(opened.session.queue[0]!.card);
  });
});

describe('答案馬上落地(場景 Answers are written immediately)', () => {
  it('送出一題、還沒按下一題:reviews.json 已經有那張卡今天的 history', async () => {
    const r = await rig();
    await r.session.init();
    const card = r.session.getView().current!.card;
    expect(readReviews(r.vault)[card]!.history).toHaveLength(0);
    await answerCurrent(r.session);
    const history = readReviews(r.vault)[card]!.history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ date: TODAY, type: 'fill' });
  });

  it('寫的是真檔(原子寫入留下的暫存檔不在):reviews.json 旁邊沒有 .tmp', async () => {
    const r = await rig();
    await r.session.init();
    await answerCurrent(r.session);
    const names = (await import('node:fs')).readdirSync(join(r.vault.dir, 'state'));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('視窗與終端機同一份(場景 The interface and the terminal agree)', () => {
  it('視窗答完兩張後「關掉」:另一個 handler(像終端機重開)只提供剩下的三張,順序跟原本一樣', async () => {
    const r = await rig();
    await r.session.init();
    for (let i = 0; i < 2; i += 1) {
      await answerCurrent(r.session);
      await r.session.next();
    }
    const again = await r.reopen();
    await again.session.init();
    const v = again.session.getView();
    expect([v.answeredCount, v.totalCount]).toEqual([2, 5]);
    const rest = await walkToEnd(again.session);
    expect(rest).toEqual(DEFAULT_FIVE_ORDER.slice(2));
  });

  it('終端機那一邊的引擎(openDay)也看到:已答的兩張不再出現', async () => {
    const r = await rig();
    await r.session.init();
    for (let i = 0; i < 2; i += 1) {
      await answerCurrent(r.session);
      await r.session.next();
    }
    const opened = await openDay({ learningDir: r.vault.dir, today: TODAY, router: fakeRouter() as never, env: r.env });
    if (opened.kind !== 'ready') throw new Error(`openDay 回 ${opened.kind}`);
    expect(opened.resumed).toBe(true);
    expect(opened.session.queue.map((q) => q.card)).toEqual(DEFAULT_FIVE_ORDER.slice(2));
    const answered = Object.entries(readReviews(r.vault)).filter(([, rec]) => rec.history.some((h) => h.date === TODAY)).map(([id]) => id);
    expect(answered.sort()).toEqual(DEFAULT_FIVE_ORDER.slice(0, 2).sort());
  });
});

describe('批改失敗不動卡片(場景 A grading error still leaves the card untouched)', () => {
  const APPLY_ONLY = { 'sec-0001': { stage: 3, overdue: 2 } };

  it('雲端回兩次不合法:顯示「評分失敗,請再試一次」,同一題留著,reviews.json 一個位元組都沒變', async () => {
    const r = await rig({ entries: APPLY_ONLY });
    await r.session.init();
    expect(r.session.getView().current).toMatchObject({ card: 'sec-0001', type: 'apply' });
    const before = readFileSync(reviewsPath(r.vault), 'utf8');
    await r.session.submitApply('GARBAGE 亂回');
    const v = r.session.getView();
    expect(v.gradingError).toBe('評分失敗,請再試一次');
    expect(v.state).toBe('question');
    expect(v.current).toMatchObject({ card: 'sec-0001', type: 'apply' });
    expect(v.result).toBeUndefined();
    expect(readFileSync(reviewsPath(r.vault), 'utf8')).toBe(before);
    expect(r.router.applyCalls).toBe(2);
  });

  it('再送一次(這次雲端回得出來):過了,gradingError 消失,卡片這時才寫入', async () => {
    const r = await rig({ entries: APPLY_ONLY });
    await r.session.init();
    await r.session.submitApply('GARBAGE');
    await r.session.submitApply('PASSALL 我的回答');
    const v = r.session.getView();
    expect(v.gradingError).toBeUndefined();
    expect(v.result).toMatchObject({ status: 'passed', pass: true });
    expect(readReviews(r.vault)['sec-0001']!.history).toHaveLength(1);
  });

  it('失敗之後重新開始(init):還是同一題,header 沒有多算', async () => {
    const r = await rig({ entries: APPLY_ONLY });
    await r.session.init();
    await r.session.submitApply('GARBAGE');
    await r.session.init();
    expect(r.session.getView().current).toMatchObject({ card: 'sec-0001', type: 'apply' });
    expect([r.session.getView().answeredCount, r.session.getView().totalCount]).toEqual([0, 1]);
  });
});

describe('真的 reteach(連續答錯兩次的卡)', () => {
  const entries = { 'sec-0001': { stage: 1, overdue: 3, fails_in_row: 2, total_fails: 2 } };

  it('有縮短版:讀的是縮短版的路徑,畫面是去掉 frontmatter 的純文字,沒有「先看原卡」;繼續後出題', async () => {
    const r = await rig({ entries });
    writeFileSync(join(r.vault.dir, 'cards/security/sec-0001.short.md'), '---\nid: sec-0001\n---\n\n縮短版的獨特內文 ZETA-SHORT <i>斜</i>\n', 'utf8');
    await r.session.init();
    const v = r.session.getView();
    expect(v.state).toBe('reteach');
    expect(r.fs.reads).toEqual(['cards/security/sec-0001.short.md']);
    expect(v.reteach!.text).toContain('ZETA-SHORT <i>斜</i>');
    expect(v.reteach!.text).not.toContain('id: sec-0001');
    expect(v.reteach!.notice).toBeUndefined();
    await r.session.next();
    expect(r.session.getView().state).toBe('question');
    expect(r.session.getView().current!.card).toBe('sec-0001');
  });

  it('沒有縮短版:讀原卡,畫面有「縮短版還沒有產生,先看原卡」;不卡住,繼續後出題', async () => {
    const r = await rig({ entries });
    await r.session.init();
    const v = r.session.getView();
    expect(v.state).toBe('reteach');
    expect(r.fs.reads).toEqual(['cards/security/sec-0001.md']);
    expect(v.reteach!.notice).toBe('這張卡連續答錯兩次;縮短版還沒有產生,先看原卡。');
    expect(v.reteach!.text.length).toBeGreaterThan(0);
    await r.session.next();
    expect(r.session.getView().state).toBe('question');
  });

  it('reteach 不算一題:header 的總數不含它', async () => {
    const r = await rig({ entries });
    await r.session.init();
    await r.session.next();
    expect([r.session.getView().answeredCount, r.session.getView().totalCount]).toEqual([0, 1]);
  });
});

describe('真的 review-record-changed(T26)', () => {
  const FULL = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';

  it('出題後別處改了 reviews.json:送出得到全文與「重新開始」;那一筆沒被記下;重新開始後正常出題', async () => {
    const r = await rig();
    await r.session.init();
    const card = r.session.getView().current!.card;
    // 別的地方(終端機)改了 reviews.json:另一張卡多一筆今天的紀錄
    const other = readReviews(r.vault);
    other['sec-0004']!.history.push({ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' });
    writeFileSync(reviewsPath(r.vault), `${JSON.stringify(other, null, 2)}\n`, 'utf8');
    const external = readFileSync(reviewsPath(r.vault), 'utf8');

    await answerCurrent(r.session);
    const v = r.session.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain(FULL);
    expect(v.canRestart).toBe(true);
    expect(v.canRetry).toBe(false);
    expect(readFileSync(reviewsPath(r.vault), 'utf8')).toBe(external);
    expect(readReviews(r.vault)[card]!.history).toHaveLength(0);

    await r.session.init();
    expect(r.session.getView().state).toBe('question');
    expect(r.session.getView().current!.card).toBe(card);
  });
});

describe('真的暫停與 0 張卡', () => {
  it('今天暫停:畫面 paused,沒有題目,router 一次都沒被叫', async () => {
    const r = await rig();
    await pauseDay({ learningDir: r.vault.dir, today: TODAY, env: r.env });
    const again = await r.reopen();
    await again.session.init();
    const v = again.session.getView();
    expect(v.state).toBe('paused');
    expect(v.current).toBeUndefined();
    expect(v.message).toContain('--unpause');
    expect(again.calls.map((c) => c.method)).toEqual(['start']);
    expect(again.router.calls).toBe(0);
  });

  it('資料夾沒有任何卡:說掃描到 0 張卡,不說今天沒有到期', async () => {
    const r = await rig();
    rmSync(join(r.vault.dir, 'cards'), { recursive: true, force: true });
    const again = await r.reopen();
    await again.session.init();
    const v = again.session.getView();
    expect(v.state).toBe('error');
    expect(v.message).toContain('掃描到 0 張卡');
    expect(v.message).not.toContain('今天沒有到期');
    expect(v.message).toContain('改好之後按「再試一次」。');
    expect(v.canRetry).toBe(true);
    expect(v.canRestart).toBe(false);
  });

  it('資料夾沒有任何卡 → 把卡放回去 → 按「再試一次」:重新 start,出題(真 core 的 start 會重掃卡片)', async () => {
    const r = await rig();
    const backup = join(r.vault.dir, 'cards-away');
    renameSync(join(r.vault.dir, 'cards'), backup);
    const again = await r.reopen();
    await again.session.init();
    expect(again.session.getView().canRetry).toBe(true);
    renameSync(backup, join(r.vault.dir, 'cards'));
    await again.session.init();
    expect(again.calls.map((c) => c.method).filter((m) => m === 'start')).toHaveLength(2);
    expect(again.session.getView().state).toBe('question');
    expect(again.session.getView().canRetry).toBe(false);
  });

  it('沒有到期的卡:empty,「今天沒有到期」', async () => {
    const r = await rig({ entries: { 'sec-0001': { stage: 1, overdue: -5 } } });
    await r.session.init();
    expect(r.session.getView().state).toBe('empty');
    expect(r.session.getView().message).toContain('今天沒有到期');
  });
});

describe('做完:summary 在側車 snapshot(驗收 2 的 done 列)', () => {
  it('走完整輪:每張卡都有今天的 history;叫了一次 summary;learning 有新的 snapshot commit;畫面 done', async () => {
    const r = await rig({ git: true });
    await r.session.init();
    const before = headMessage(r.vault);
    await walkToEnd(r.session);
    expect(r.session.getView().state).toBe('done');
    expect(r.session.getView().message).toBe('今天的複習都做完了。');
    expect(r.calls.filter((c) => c.method === 'summary')).toHaveLength(1);
    for (const id of Object.keys(DEFAULT_FIVE)) {
      expect(readReviews(r.vault)[id]!.history.some((h) => h.date === TODAY), id).toBe(true);
    }
    expect(headMessage(r.vault)).not.toBe(before);
  });
});

describe('測試模式標記(真的 start 的 fakeCloud = Boolean(env.LC_REVIEW_FAKE_CLOUD))', () => {
  it('環境有 LC_REVIEW_FAKE_CLOUD:有標記', async () => {
    const r = await rig({ env: { LC_REVIEW_FAKE_CLOUD: '/some/fake-cloud.mjs' } });
    await r.session.init();
    expect(r.session.getView().testModeNotice).toBe('測試模式:批改是假的');
  });

  it('環境沒有:沒有標記', async () => {
    const r = await rig();
    await r.session.init();
    expect(r.session.getView().testModeNotice).toBeUndefined();
  });
});
