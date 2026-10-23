/**
 * 14-hud-skin phase-2(工單 T15)不退步的快速部分:done phase 的 .feature 雜湊與 phase 表。測試 agent 寫;開發 worker 不改。
 * 真正跑 06、07 場景的是 cucumber 的步驟(子行程)。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DONE_PHASES_TAG_EXPRESSION, DONE_PHASE_FEATURES, PENDING_DONE_PHASES } from './card-design-values-test-support.js';
import { donePhases, doneFeatureProblems, evalTagExpression, scenarioTags, sha256 } from './card-regression-test-support.js';
import { REPO_ROOT } from './test-support.js';

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
    writeFileSync(join(root, 'features', '06-test-card', 'phase-2.feature'), feat);
    writeFileSync(join(root, 'features', '06-test-card', 'phase-3.feature'), feat);
    writeFileSync(join(root, 'features', '07-teach-card', 'phase-2.feature'), feat);
    return root;
  }
  const table = (rows: string[]) => ['| # | 內容 | wave | 狀態 | 日期 |', '|---|---|---|---|---|', ...rows].join('\n');
  const pinnedFor = (feat: string) => {
    const root = fake(table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |', '| 3 | c | W | done | d |']), table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |']), feat);
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
    writeFileSync(join(root, 'features/07-teach-card/FEATURE.md'), table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |', '| 3 | c | W | done | d |']));
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/phase-3 已經是 done/);
  });

  it('PENDING_DONE_PHASES 平常是空的(phase 標 done 之後就清掉)', () => {
    expect(PENDING_DONE_PHASES).toEqual([]);
  });

  it('清單空時,釘住但不是 done 的 phase 會報(06 phase-3 被翻回非 done 也抓得到)', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    expect(doneFeatureProblems(root, pinned), '三個 phase 都 done').toEqual([]);
    writeFileSync(join(root, 'features/06-test-card/FEATURE.md'), table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |', '| 3 | c | W | ready | d |']));
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/phase-3 在清單裡,但 FEATURE.md 不是 done/);
  });

  it('機制還在:列了 pending 的 phase,FEATURE.md 還沒 done 時放過、雜湊照查', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    writeFileSync(join(root, 'features/06-test-card/FEATURE.md'), table(['| 1 | a | W | done | d |', '| 2 | b | W | done | d |', '| 3 | c | W | ready | d |']));
    const pending = [{ folder: '06-test-card', phase: 'phase-3' }];
    expect(doneFeatureProblems(root, pinned, pending)).toEqual([]);
    writeFileSync(join(root, 'features/06-test-card/phase-3.feature'), 'Feature: changed\n');
    expect(doneFeatureProblems(root, pinned, pending).join('\n')).toMatch(/phase-3\.feature 被改過了/);
  });

  it('清單裡的 phase 不再是 done → 抓到', () => {
    const { root, pinned } = pinnedFor('Feature: x\n');
    writeFileSync(join(root, 'features/06-test-card/FEATURE.md'), table(['| 1 | a | W | done | d |', '| 2 | b | W | in-progress | d |']));
    expect(doneFeatureProblems(root, pinned).join('\n')).toMatch(/不是 done/);
  });
});

describe('子行程的標籤式涵蓋每一個釘住的 done phase(場景 4)', () => {
  const FOLDER_TAG: Record<string, string> = { '06-test-card': '@test-card', '07-teach-card': '@teach-card' };
  const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

  it('釘住的每一份 .feature:至少一個非 @manual 的場景被標籤式選中,所有 @manual 場景都不選', () => {
    for (const p of DONE_PHASE_FEATURES) {
      const scenarios = scenarioTags(read(p.file));
      expect(scenarios.length, `${p.file} 讀不到場景`).toBeGreaterThan(0);
      const picked = scenarios.filter((s) => evalTagExpression(DONE_PHASES_TAG_EXPRESSION, s.tags));
      const nonManual = scenarios.filter((s) => !s.tags.has('@manual'));
      expect(picked.map((s) => s.name), `${p.file} 的非 @manual 場景要全部被選中`).toEqual(nonManual.map((s) => s.name));
      expect(picked.length, `${p.file} 沒有場景被選中`).toBeGreaterThan(0);
    }
  });

  it('還沒 done 的 phase 不會被拉進來(沒釘住的 .feature,例如之後的 phase-3、phase-4)', () => {
    const pinned = new Set(DONE_PHASE_FEATURES.map((p) => p.file));
    for (const folder of Object.keys(FOLDER_TAG)) {
      const dir = join(REPO_ROOT, 'features', folder);
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.feature'))) {
        const rel = `features/${folder}/${f}`;
        if (pinned.has(rel)) continue;
        const wrongly = scenarioTags(read(rel)).filter((s) => evalTagExpression(DONE_PHASES_TAG_EXPRESSION, s.tags));
        expect(wrongly.map((s) => s.name), `${rel} 不是 done,場景不該被選中`).toEqual([]);
      }
    }
  });

  it('標籤式求值器本身:and / or / not / 括號', () => {
    const t = (...tags: string[]) => new Set(tags);
    expect(evalTagExpression('@a and (@b or @c) and not @m', t('@a', '@c'))).toBe(true);
    expect(evalTagExpression('@a and (@b or @c) and not @m', t('@a', '@c', '@m'))).toBe(false);
    expect(evalTagExpression('@a and (@b or @c) and not @m', t('@a'))).toBe(false);
    expect(evalTagExpression('(@a and @b) or (@c and @d)', t('@c', '@d'))).toBe(true);
    expect(evalTagExpression('(@a and @b) or (@c and @d)', t('@a', '@d'))).toBe(false);
  });
});
