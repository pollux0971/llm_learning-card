/**
 * T43(07 phase-3):深入寫的每個檔都走 01 的 `writeFileAtomic`(CLAUDE.md 硬規則 5 的精神;工單第 3 節),
 * 而且考題檔先於卡檔(同一張卡)。用 `vi.mock` 把 `schema/atomic-write.ts` 的 `writeFileAtomic` 包一層(真的照跑),記下寫入的路徑與順序。
 * 測試 agent 寫;開發 worker 不改。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { candidates, cleanupRigs, deepRig, newIds } from './t43-harness.js';

const control = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock('../../packages/core/src/schema/atomic-write.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../packages/core/src/schema/atomic-write.js')>();
  return {
    ...real,
    writeFileAtomic: (path: string, content: string, mode?: number): void => {
      control.paths.push(path);
      real.writeFileAtomic(path, content, mode);
    },
  };
});

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

afterAll(cleanupRigs);
beforeEach(() => {
  control.paths.length = 0;
});

describe('深入的寫入經過 writeFileAtomic,而且考題檔先於卡檔', () => {
  it('每張新卡的卡檔與考題檔、deps.json 都是 writeFileAtomic 寫的;同一張卡的考題檔在卡檔之前', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(3); } });
    await r.view('teach.open');
    control.paths.length = 0;
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const written = control.paths.map((p) => p.slice(r.v.dir.length + 1));
    for (const id of newIds(3)) {
      const q = written.indexOf(`questions/${id}.yaml`);
      const c = written.indexOf(`cards/security/${id}.md`);
      expect(q, `questions/${id}.yaml 要經過 writeFileAtomic`).toBeGreaterThanOrEqual(0);
      expect(c, `cards/security/${id}.md 要經過 writeFileAtomic`).toBeGreaterThanOrEqual(0);
      expect(q, `${id}:考題檔先、卡檔後`).toBeLessThan(c);
    }
    expect(written, '圖也走原子寫入(契約 §11b)').toContain('graph/deps.json');
    expect(control.paths.every((p) => p.startsWith(r.v.dir)), '只寫這個 learning 目錄').toBe(true);
    expect(written.filter((p) => p.startsWith('state/')), '深入不寫 state/(log 是 append,reviews.json 不動)').not.toContain('state/reviews.json');
  });

  it('沒有成功就沒有寫入:被取消或失敗的工作不經過 writeFileAtomic', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    control.paths.length = 0;
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    await r.send('teach.cancel');
    gate.release();
    await r.quiet();
    expect(control.paths).toEqual([]);
  });
});
