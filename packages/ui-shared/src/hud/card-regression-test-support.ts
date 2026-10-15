/**
 * 14-hud-skin phase-2(工單 T15)「長相改了,行為不變」:06、07 已 done 的 phase 的 .feature 沒改、而且清單是最新的。
 * 子行程跑那些場景是 cucumber 步驟(hud-skin-phase2.steps.ts)的事;這裡只有可以快速驗的部分。測試 agent 寫;開發 worker 不改。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DONE_PHASE_FEATURES } from './card-design-values-test-support.js';
import { REPO_ROOT } from './test-support.js';

/** FEATURE.md 的 phase 表裡狀態是 done 的 phase 編號(回傳 `phase-N`) */
export function donePhases(featureMd: string): string[] {
  const out: string[] = [];
  for (const line of featureMd.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^\d+$/.test(cells[0] ?? '') && cells.includes('done')) out.push(`phase-${cells[0]}`);
  }
  return out;
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * 回傳問題清單:
 * - 06、07 的 FEATURE.md 有 done 的 phase 不在釘住的清單裡(要有意識地更新清單與雜湊),或清單裡的 phase 不再是 done;
 * - 釘住的 .feature 檔內容雜湊變了(.feature 被改了)。
 */
export function doneFeatureProblems(root: string = REPO_ROOT, pinned = DONE_PHASE_FEATURES): string[] {
  const problems: string[] = [];
  for (const folder of ['06-test-card', '07-teach-card']) {
    const md = join(root, 'features', folder, 'FEATURE.md');
    if (!existsSync(md)) { problems.push(`${md} 不存在`); continue; }
    const done = donePhases(readFileSync(md, 'utf8'));
    const listed = pinned.filter((p) => p.folder === folder).map((p) => p.phase);
    for (const ph of done) if (!listed.includes(ph)) problems.push(`${folder} 的 ${ph} 已經是 done,但不在釘住的清單裡(card-design-values-test-support.ts 的 DONE_PHASE_FEATURES)`);
    for (const ph of listed) if (!done.includes(ph)) problems.push(`${folder} 的 ${ph} 在清單裡,但 FEATURE.md 不是 done`);
  }
  for (const p of pinned) {
    const file = join(root, p.file);
    if (!existsSync(file)) { problems.push(`${p.file} 不存在`); continue; }
    if (sha256(file) !== p.sha256) problems.push(`${p.file} 被改過了(雜湊 ${sha256(file).slice(0, 12)}… ≠ 釘住的 ${p.sha256.slice(0, 12)}…)`);
  }
  return problems;
}
