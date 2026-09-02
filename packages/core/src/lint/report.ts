import type { LintResult, LintStatusType } from './types.js';

/**
 * 一個問題一行,附型別、卡片 id、路徑;開頭是問題數;狀態(stale / source_missing)
 * 分開列,不計入問題數。CLI 把同樣的內容寫進報告檔,也印到終端機。
 */
export function formatReport(result: LintResult, generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`# Lint report — ${generatedAt}`);
  lines.push('');
  lines.push(`${result.problems.length} problems found.`);
  lines.push('');

  if (result.problems.length) {
    lines.push('## Problems');
    for (const p of result.problems) {
      lines.push(`- ${p.type} ${p.card ?? '-'} ${p.path} — ${p.detail}`);
    }
    lines.push('');
  }

  const statusGroups = new Map<LintStatusType, string[]>();
  for (const s of result.statuses) {
    if (!statusGroups.has(s.type)) statusGroups.set(s.type, []);
    statusGroups.get(s.type)!.push(`- ${s.card} ${s.path}`);
  }
  for (const [type, entries] of statusGroups) {
    lines.push(`## status: ${type}`);
    lines.push(...entries);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
