/**
 * T43(07 phase-3):麵包屑、學過、回上一層、主流程只排 level 0 與 1(工單第 4 節,ADR-079 D4、D5、D6)。
 * 測試 agent 寫;開發 worker 不改。用 `vi.mock` 包 core 的 `saveReviewsIfUnchanged`(同 t37-conflict.test.ts 的做法),
 * 所以「同一次寫入」是數得出來的:每次呼叫記下它寫進去的卡 id。
 *
 * 規則(工單第 4 節):
 *   - 下一個(在一組子卡裡):這張子卡記學過,換到下一張兄弟;
 *   - 下一個(在最後一張子卡):這張子卡記學過,再對父卡做一次「下一個」——父卡記學過;父卡本身也在一組子卡裡就換到它的下一張兄弟,
 *     也是那組的最後一張就再往上一層;回到主流程照 phase-2 的下一個(這個類別第一張沒學的)。**這一路要記的卡在同一次寫入裡一起寫**
 *     (重讀、加上這幾筆、saveReviewsIfUnchanged、衝突重試一次,還不過回 teach-record-changed、一筆都不寫);
 *   - 回上一層:顯示這組子卡的父卡,丟掉一層麵包屑,目前這張子卡**不**記學過;
 *   - 換類別 / 跟先備 / teach.open:麵包屑清空,父卡不記;
 *   - 主流程只排 level 0、1;「剩幾張」也只算這兩層;
 *   - 先備提示不列麵包屑上的父卡。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedDue } from './review-session-harness.js';
import { freshLearned } from './teach-harness.js';
import {
  AFTER_PARENT,
  PARENT,
  PARENT_TITLE,
  TODAY,
  cleanupRigs,
  deepRig,
  diskHashes,
  errorKind,
  errorMessage,
  logEvents,
  readReviews,
  type Obj,
  type Rig,
} from './t43-harness.js';

interface SaveCall {
  /** 這次呼叫要寫進去的 reviews 的卡 id(排序) */
  ids: string[];
  expected: string;
}
const control = vi.hoisted(() => ({
  calls: [] as { ids: string[]; expected: string }[],
  sabotage: 0,
  foreign: undefined as undefined | ((dir: string) => void),
}));

vi.mock('../../packages/core/src/session/io.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../packages/core/src/session/io.js')>();
  return {
    ...real,
    saveReviewsIfUnchanged: (dir: string, reviews: Record<string, unknown>, expected: string): string => {
      control.calls.push({ ids: Object.keys(reviews).sort(), expected });
      if (control.sabotage > 0) {
        control.sabotage -= 1;
        control.foreign?.(dir);
      }
      return real.saveReviewsIfUnchanged(dir, reviews as never, expected);
    },
  };
});

afterAll(cleanupRigs);
beforeEach(() => {
  control.calls.length = 0;
  control.sabotage = 0;
  control.foreign = undefined;
});

const saves = (): SaveCall[] => control.calls.map((c) => ({ ids: c.ids, expected: c.expected }));
const learnedIds = (r: Rig): string[] => logEvents(r.v, 'learned').map((e) => String(e['card']));
const reviewIds = (r: Rig): string[] => Object.keys(readReviews(r.v)).sort();

describe('Scenario: Next within a set of children', () => {
  it('兩張子卡:下一個 → 第一張進 reviews.json、畫面是第二張(from 還是父卡);再下一個 → 第二張與父卡一起進、畫面是主流程裡父卡之後那張', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const first = await r.view('teach.deepen');
    expect(first.card?.id).toBe('sec-0004');
    control.calls.length = 0;

    const second = await r.view('teach.next');
    expect(second.card?.id).toBe('sec-0005');
    expect(second.from).toEqual({ id: PARENT, title: PARENT_TITLE });
    expect(second.canBack).toBe(true);
    expect(reviewIds(r)).toEqual(['sec-0001', 'sec-0004']);
    expect(readReviews(r.v)['sec-0004']).toEqual(freshLearned(TODAY));
    expect(learnedIds(r)).toEqual(['sec-0004']);
    expect(saves().map((s) => s.ids)).toEqual([['sec-0001', 'sec-0004']]);

    control.calls.length = 0;
    const third = await r.view('teach.next');
    expect(third.card?.id, '父卡之後那張').toBe(AFTER_PARENT);
    expect(third.from).toBeNull();
    expect(third.canBack).toBe(false);
    expect(reviewIds(r)).toEqual(['sec-0001', 'sec-0002', 'sec-0004', 'sec-0005']);
    expect(readReviews(r.v)['sec-0005']).toEqual(freshLearned(TODAY));
    expect(readReviews(r.v)['sec-0002'], '父卡記學過').toEqual(freshLearned(TODAY));
    expect(saves().map((s) => s.ids), '最後一張子卡與父卡是同一次寫入,不是兩次').toEqual([['sec-0001', 'sec-0002', 'sec-0004', 'sec-0005']]);
    expect([...learnedIds(r)].sort()).toEqual(['sec-0002', 'sec-0004', 'sec-0005']);
    expect(logEvents(r.v, 'learned')).toHaveLength(3);
  });

  it('寫成功之後才記 learned(每張各一筆),順序是子卡、再父卡', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.next');
    await r.view('teach.next');
    expect(learnedIds(r)).toEqual(['sec-0004', 'sec-0005', 'sec-0002']);
  });

  it('兩層深入後在最後一張按下一個,一路往上記學過,各層都在同一次寫入裡', async () => {
    const r = await deepRig({ children: 2, grandchildren: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen'); // sec-0004
    const g1 = await r.view('teach.deepen'); // sec-0006
    expect(g1.card?.id).toBe('sec-0006');
    expect(g1.from?.id).toBe('sec-0004');
    const g2 = await r.view('teach.next');
    expect(g2.card?.id).toBe('sec-0007');
    expect(g2.from?.id).toBe('sec-0004');
    control.calls.length = 0;

    // 最後一個孫卡:孫卡與它的父卡 sec-0004 一起記;sec-0004 在 sec-0002 的子卡裡,所以換到它的下一張兄弟 sec-0005
    const sib = await r.view('teach.next');
    expect(sib.card?.id).toBe('sec-0005');
    expect(sib.from?.id).toBe(PARENT);
    expect(sib.canBack).toBe(true);
    expect(saves().map((s) => s.ids)).toEqual([['sec-0001', 'sec-0004', 'sec-0006', 'sec-0007']]);

    control.calls.length = 0;
    // sec-0005 是最後一張:它與 sec-0002 一起記,回主流程
    const main = await r.view('teach.next');
    expect(main.card?.id).toBe(AFTER_PARENT);
    expect(main.canBack).toBe(false);
    expect(saves().map((s) => s.ids)).toEqual([['sec-0001', 'sec-0002', 'sec-0004', 'sec-0005', 'sec-0006', 'sec-0007']]);
  });

  it('已經在 reviews.json 的子卡不重複寫,也不重複記 learned', async () => {
    const r = await deepRig({ children: 2, learned: ['sec-0001', 'sec-0004'] });
    await r.view('teach.open');
    await r.view('teach.deepen'); // 學過的子卡也從第一張開始顯示
    const second = await r.view('teach.next');
    expect(second.card?.id).toBe('sec-0005');
    expect(learnedIds(r), 'sec-0004 本來就學過').toEqual([]);
    await r.view('teach.next');
    expect(learnedIds(r)).toEqual(['sec-0005', 'sec-0002']);
  });

  it('衝突一次(重讀比對沒過):重試一次就過,最後一張子卡與父卡都寫進去', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.next');
    control.calls.length = 0;
    control.sabotage = 1;
    control.foreign = (dir) => {
      const path = join(dir, 'state/reviews.json');
      const cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      cur['net-0001'] = freshLearned('2026-09-09', TODAY);
      writeFileSync(path, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
    };
    const res = await r.view('teach.next');
    expect(res.card?.id).toBe(AFTER_PARENT);
    expect(reviewIds(r)).toEqual(['net-0001', 'sec-0001', 'sec-0002', 'sec-0004', 'sec-0005']);
    expect(control.calls.length).toBe(2);
  });

  it('衝突兩次:teach-record-changed + 固定字樣;最後一張子卡與父卡一筆都沒寫、沒有 learned、畫面還在最後一張子卡', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.next'); // sec-0004 已記
    const learnedBefore = learnedIds(r);
    control.sabotage = 2;
    let n = 0;
    control.foreign = (dir) => {
      n += 1;
      const path = join(dir, 'state/reviews.json');
      const cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      cur[`net-000${n}`] = freshLearned('2026-09-09', TODAY);
      writeFileSync(path, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
    };
    const res = await r.send('teach.next');
    expect(res['ok']).toBe(false);
    expect(errorKind(res)).toBe('teach-record-changed');
    expect(errorMessage(res)).toBe('學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。');
    expect(reviewIds(r), '除了別人寫的,沒有 sec-0005 與 sec-0002').toEqual(['net-0001', 'net-0002', 'sec-0001', 'sec-0004']);
    expect(learnedIds(r)).toEqual(learnedBefore);
    const still = await r.view('teach.poll');
    expect(still.card?.id).toBe('sec-0005');
    expect(still.canBack).toBe(true);
    expect(still.from?.id).toBe(PARENT);
  });
});

describe('回上一層(teach.back)', () => {
  it('在子卡上回上一層:回到父卡,麵包屑少一層;子卡不記學過;reviews.json、log 都不動', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    const before = diskHashes(r.v);
    const logBefore = readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8');
    control.calls.length = 0;
    const back = await r.view('teach.back');
    expect(back.card?.id).toBe(PARENT);
    expect(back.from).toBeNull();
    expect(back.canBack).toBe(false);
    expect(back.generating).toBe(false);
    expect(diskHashes(r.v)).toEqual(before);
    expect(readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8')).toBe(logBefore);
    expect(control.calls, '回上一層不走 saveReviewsIfUnchanged').toHaveLength(0);
  });

  it('兩層深入:回上一層一次一層;回到的是「這組子卡的父卡」,不是主流程的下一張', async () => {
    const r = await deepRig({ children: 2, grandchildren: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.deepen');
    await r.view('teach.next'); // 孫卡 2(孫卡 1 已記)
    const up1 = await r.view('teach.back');
    expect(up1.card?.id).toBe('sec-0004');
    expect(up1.from?.id).toBe(PARENT);
    expect(up1.canBack).toBe(true);
    const up2 = await r.view('teach.back');
    expect(up2.card?.id).toBe(PARENT);
    expect(up2.canBack).toBe(false);
    expect(errorKind(await r.send('teach.back'))).toBe('bad-request');
    expect(reviewIds(r), '只有孫卡 1(按過下一個的那張)進了 reviews.json').toEqual(['sec-0001', 'sec-0006']);
  });

  it('回上一層之後再深入:又回到子卡的第一張(麵包屑重新推一層)', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.next');
    await r.view('teach.back');
    const again = await r.view('teach.deepen');
    expect(again.card?.id, '從第一張開始,學過的也顯示').toBe('sec-0004');
    expect(again.from?.id).toBe(PARENT);
  });
});

describe('換類別 / 跟先備 / teach.open:麵包屑清空,父卡不記', () => {
  it('在子卡上換類別:目前這張子卡記學過、父卡不記、麵包屑清空', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    const net = await r.view('teach.switch', { category: 'network' });
    expect(net).toMatchObject({ category: 'network', from: null, canBack: false });
    expect(reviewIds(r)).toEqual(['sec-0001', 'sec-0004']);
    expect(learnedIds(r)).toEqual(['sec-0004']);
    expect(errorKind(await r.send('teach.back')), '換類別之後沒有麵包屑').toBe('bad-request');
    const back = await r.view('teach.switch', { category: 'security' });
    expect(back.card?.id, '父卡沒記學過,所以回來還是它').toBe(PARENT);
    expect(back.canBack).toBe(false);
  });

  it('teach.open 清空麵包屑;不寫 reviews.json', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    await r.view('teach.deepen');
    const before = diskHashes(r.v);
    const reopened = await r.view('teach.open');
    expect(reopened).toMatchObject({ canBack: false, from: null, card: { id: PARENT } });
    expect(diskHashes(r.v)).toEqual(before);
  });

  it('跟先備走:目前這張不記學過,麵包屑清空', async () => {
    const r = await deepRig({ children: 2, childPrereqs: [AFTER_PARENT] });
    await r.view('teach.open');
    const child = await r.view('teach.deepen');
    expect(child.prereqs.map((p) => p.id), '先備提示不列麵包屑上的父卡,只列真正的先備').toEqual([AFTER_PARENT]);
    const before = diskHashes(r.v);
    const followed = await r.view('teach.prereq', { index: 0 });
    expect(followed.card?.id).toBe(AFTER_PARENT);
    expect(followed.canBack).toBe(false);
    expect(followed.from).toBeNull();
    expect(diskHashes(r.v), '跟先備不寫任何東西(子卡也沒記)').toEqual(before);
    expect(errorKind(await r.send('teach.back'))).toBe('bad-request');
  });
});

describe('主流程只排 level 0、1(D5,設計 §4.1);level 2 以上只從深入進去', () => {
  it('剩幾張只算 level 0 與 1:有兩張沒學的 level 2 子卡,security 還是剩 2 張(sec-0002、sec-0003)', async () => {
    const r = await deepRig({ children: 2 });
    const opened = await r.view('teach.open');
    expect(opened.categories.find((c) => c.id === 'security')?.remaining).toBe(2);
    expect(opened.categories.find((c) => c.id === 'network')?.remaining).toBe(2);
  });

  it('level 0、1 都學完,即使還有沒學的 level 2:類別就是學完了(card: null),下一個不會跑到子卡去', async () => {
    const r = await deepRig({ children: 2, grandchildren: 2, learned: ['sec-0001', 'sec-0003'] });
    const opened = await r.view('teach.open');
    expect(opened.card?.id).toBe(PARENT);
    const next = await r.view('teach.next');
    expect(next.card, '不排 level 2 以上').toBeNull();
    expect(next.categories.find((c) => c.id === 'security')?.remaining).toBe(0);
    expect(reviewIds(r)).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);
  });

  it('子卡學過之後剩幾張也不變(不會把 level 2 學過的算成少了一張)', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const child = await r.view('teach.deepen');
    expect(child.categories.find((c) => c.id === 'security')?.remaining).toBe(2);
    const next = await r.view('teach.next');
    expect(next.categories.find((c) => c.id === 'security')?.remaining, 'sec-0004 學過了,但它本來就不在剩幾張裡').toBe(2);
  });

  it('deck 本身:沒有 order 檔(照 id 排)時也只排 level 0、1', async () => {
    const r = await deepRig({ children: 2 });
    rmSync(join(r.v.dir, 'graph/order-security.json'));
    const opened = await r.view('teach.open');
    expect(opened.card?.id).toBe(PARENT);
    await r.view('teach.next');
    const after = await r.view('teach.next');
    expect(after.card, 'sec-0004、sec-0005 是 level 2,不排').toBeNull();
  });
});

describe('考試卡基準(ADR-077 D2 b)在多張一起寫之後仍然有效', () => {
  it('開著的考試卡 session:教學卡一次寫好幾張之後,考試卡的 next 與 submit 不會報 review-record-changed', async () => {
    const r = await deepRig({ children: 2 });
    seedDue(r.v, ['sec-0001'], [1]);
    const started = await r.send('start');
    expect(started['ok'], JSON.stringify(started)).toBe(true);
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.next');
    await r.view('teach.next'); // 一次寫兩張(sec-0005 與 sec-0002)
    const q = await r.send('next');
    expect(q['ok'], JSON.stringify(q)).toBe(true);
    const question = q['result'] as Obj;
    expect(question['kind']).toBe('question');
    const params = question['type'] === 'fill' ? { fill: Array.from({ length: Number(question['blanks']) }, () => 'x') } : { apply: 'x' };
    const submitted = await r.send('submit', params);
    expect(submitted['ok'], JSON.stringify(submitted)).toBe(true);
  });
});

