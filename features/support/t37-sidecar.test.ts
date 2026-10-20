/**
 * T37:教學卡動作走真的側車子行程(`scripts/review-sidecar.ts`,跟 Rust 起的同一支)與真的終端機 `scripts/review.ts --dry-run`。
 * 測試 agent 寫;開發 worker 不改。看磁碟,不看畫面。
 *
 * 全部用暫存根(learning、XDG_*、HOME 同一個 mkdtemp)、假雲端(`LC_REVIEW_FAKE_CLOUD`),不碰真的 learning/,不准 live。
 * 本來就綠:沒有(基底上側車不認得 teach.*,回 unknown-method)。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { runReview } from './review-session-harness.js';
import { spawnSidecar, type Sidecar } from './review-sidecar-harness.js';
import { TODAY, TOMORROW, createTeachVault, freshLearned, learnedEvents, logText, readReviews, removeVault, type Vault } from './teach-harness.js';

const vaults: Vault[] = [];
const sidecars: Sidecar[] = [];
afterAll(() => {
  for (const s of sidecars) s.kill();
  for (const v of vaults) removeVault(v);
});

async function boot(opts: Parameters<typeof spawnSidecar>[1] = {}, vaultOpts: Parameters<typeof createTeachVault>[0] = {}): Promise<{ v: Vault; sc: Sidecar; id: () => number }> {
  const v = createTeachVault(vaultOpts);
  vaults.push(v);
  const sc = spawnSidecar(v, opts);
  sidecars.push(sc);
  const hello = await sc.nextLine(60_000);
  expect(hello, `側車沒有在 60 秒內送出 hello(stderr:${sc.stderr().slice(-400)})`).toBeDefined();
  expect((JSON.parse(hello!) as { kind?: string }).kind).toBe('hello');
  let n = 0;
  return { v, sc, id: () => (n += 1) };
}

const req = (id: number, method: string, params: Record<string, unknown> = {}): Record<string, unknown> => ({ v: 1, id, method, params });

describe('側車子行程認得四個教學卡動作', () => {
  it('teach.open 回形狀對的結果;stdout 每一行都是一則完整的 JSON(沒有 console 輸出混進來)', async () => {
    const { sc, id } = await boot();
    const res = await sc.call(req(id(), 'teach.open'));
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const result = res.result as { category: string; card: { id: string } | null };
    expect(result.category).toBe('security');
    expect(result.card?.id).toBe('sec-0002');
    for (const line of sc.stdoutLines) expect(() => JSON.parse(line), line).not.toThrow();
    expect(sc.stdoutLines).toHaveLength(2);
    expect(sc.stdoutTail()).toBe('');
  }, 120_000);

  it('teach.next 回應送出之後立刻 SIGKILL:磁碟上已經有那一張(reviews.json 與完整的一行 learned),不是只在記憶體', async () => {
    const { v, sc, id } = await boot();
    await sc.call(req(id(), 'teach.open'));
    const res = await sc.call(req(id(), 'teach.next'));
    expect(res.ok, JSON.stringify(res)).toBe(true);
    sc.kill();
    expect(await sc.exited()).not.toBe('timeout');
    expect(readReviews(v)).toEqual({ 'sec-0002': freshLearned() });
    expect(learnedEvents(v).map((e) => e.card)).toEqual(['sec-0002']);
    expect(logText(v).endsWith('\n')).toBe(true);
  }, 120_000);

  it('LC_REVIEW_TODAY 釘一個日期:learned_at 是那一天、next_due 是隔天', async () => {
    const { v, sc, id } = await boot({ today: '2030-02-28' });
    await sc.call(req(id(), 'teach.open', { category: 'language' }));
    await sc.call(req(id(), 'teach.next'));
    expect(readReviews(v)['lang-0003']).toEqual(freshLearned('2030-02-28', '2030-03-01'));
  }, 120_000);

  it('壞請求回 bad-request 而且側車還活著、狀態不變', async () => {
    const { v, sc, id } = await boot();
    await sc.call(req(id(), 'teach.open'));
    const bad = await sc.call(req(id(), 'teach.switch', { category: '../language' }));
    expect(bad.ok).toBe(false);
    expect((bad.error as { kind: string }).kind).toBe('bad-request');
    expect(sc.isAlive()).toBe(true);
    expect(readReviews(v)).toEqual({});
  }, 120_000);
});

describe('學過的卡真的進排程(跟終端機同一份磁碟)', () => {
  const cardsListed = (stdout: string): string[] =>
    stdout
      .split('\n')
      .map((l) => /^([a-z]{2,6}-\d{4})\s+stage\s+\d/.exec(l)?.[1])
      .filter((x): x is string => x !== undefined);

  it('教學卡標了 sec-0002 和 lang-0003:今天終端機的名單裡沒有它們;隔天有(stage 1、明天到期)', async () => {
    const { v, sc, id } = await boot();
    await sc.call(req(id(), 'teach.open'));
    await sc.call(req(id(), 'teach.next'));
    await sc.call(req(id(), 'teach.switch', { category: 'language' }));
    await sc.call(req(id(), 'teach.next'));
    sc.kill();
    await sc.exited();
    const today = await runReview(v, { today: TODAY, args: ['--dry-run'] });
    expect(today.status, today.output).toBe(0);
    expect(cardsListed(today.stdout)).toEqual([]);
    const tomorrow = await runReview(v, { today: TOMORROW, args: ['--dry-run'] });
    expect(tomorrow.status, tomorrow.output).toBe(0);
    expect(cardsListed(tomorrow.stdout).sort()).toEqual(['lang-0003', 'sec-0002', 'sec-0003']);
  }, 180_000);
});
