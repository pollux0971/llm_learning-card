/**
 * 14-hud-skin phase-2(工單 T15)不退步的快速部分:done phase 的 .feature 雜湊與 phase 表。測試 agent 寫;開發 worker 不改。
 * 真正跑 06、07 場景的是 cucumber 的步驟(子行程)。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DONE_PHASE_FEATURES } from './card-design-values-test-support.js';
import { donePhases, doneFeatureProblems, sha256 } from './card-regression-test-support.js';

describe('done phase 的 .feature 沒改、清單是最新的(驗收 9)', () => {
  it('真的 repo:06、07 的 done phase 都在釘住的清單裡,.feature 的雜湊都沒變', () => {
    expect(doneFeatureProblems()).toEqual([]);
  });

  it('清單真的有東西(防止空清單綠):06、07 各至少一個 done phase', () => {
    for (const folder of ['06-test-card', '07-teach-card']) {
      expect(DONE_PHASE_FEATURES.filter((p) => p.folder === folder).length).toBeGreaterThan(0);
    }
  });

  it('donePhases 只認狀態欄是 done 的列', () => {
    const md = ['| # | 內容 | wave | 狀態 | 日期 |', '|---|---|---|---|---|', '| 1 | a | W | done | d |', '| 2 | b | W | todo | |', '| 3 | c | W | ready | |'].join('\n');
    expect(donePhases(md)).toEqual(['phase-1']);
  });
});

describe('doneFeatureProblems 抓得到', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  function fake(md06: string, md07: string, feat: string): string {
    const root = mkdtempSync(join(tmpdir(), 'card-regression-'));
    dirs.push(root);
    for (const [folder, md] of [['06-test-card', md06], ['07-teach-card', md07]] as const) {
      mkdirSync(join(root, 'features', folder), { recursive: true });
      writeFileSync(join(root, 'features', folder, 'FEATURE.md'), md);
      writeFileSync(join(root, 'features', folder, 'phase-1.feature'), feat);
    }
    return root;
  }
  const table = (rows: string[]) => ['| # | 內容 | wave | 狀態 | 日期 |', '|---|---|---|---|---|', ...rows].join('\n');
  const pinnedFor = (feat: string) => {
    const root = fake(table(['| 1 | a | W | done | d |']), table(['| 1 | a | W | done | d |']), feat);
    return { root, pinned: DONE_PHASE_FEATURES.map((p) => ({ ...p, sha256: doneFeatureHash(root, p.file) })) };
  };
  const doneFeatureHash = (root: string, file: string) => {
    // 用 fake 的檔內容算,證明同一份內容通過
    return sha256(join(root, file));
  };

  it('內容與雜湊一致、phase 表一致 → 通過', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    expect(doneFeatureProblems(root, pinned)).toEqual([]);
  });

  it('.feature 被改 → 抓到', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    writeFileSync(join(root, 'features/06-test-card/phase-1.feature'), 'Feature: changed\n');
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/被改過了/);
  });

  it('新出現 done 的 phase 不在清單裡 → 抓到', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    writeFileSync(join(root, 'features/07-teach-card/FEATURE.md'), table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |']));
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/phase-2 已經是 done/);
  });

  it('清單裡的 phase 不再是 done → 抓到', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    writeFileSync(join(root, 'features/06-test-card/FEATURE.md'), table(['| 1 | a | W | in-progress | d |']));
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/不是 done/);
  });
});
