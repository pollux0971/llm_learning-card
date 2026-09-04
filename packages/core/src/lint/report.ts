import { join } from 'node:path';
import type { DirInventory } from './scan.js';
import type { LintResult, LintStatusType } from './types.js';

/**
 * 一個問題一行,附型別、卡片 id、路徑;開頭是問題數;狀態(stale / source_missing)
 * 分開列,不計入問題數。CLI 把同樣的內容寫進報告檔,也印到終端機。
 *
 * `inv` 給了就在問題數後面加一行清點摘要(formatScanSummary)。報告檔跟終端機
 * 都要帶數字,不然「0 problems found.」在空 vault 與健康 vault 上長得一模一樣;
 * 位置刻意放在問題數**後面**,讓報告開頭仍然是問題數(09-lint 的
 * 「the report opens with a count of problems」)。
 */
export function formatReport(result: LintResult, generatedAt: string, inv?: DirInventory): string {
  const lines: string[] = [];
  lines.push(`# Lint report — ${generatedAt}`);
  lines.push('');
  lines.push(`${result.problems.length} problems found.`);
  if (inv) lines.push(formatScanSummary(inv));
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

/**
 * 「掃描器壞了」那句話。跟 check-boundaries / check-doc-links / check-standalone
 * 逐字相同,使用者在三支守門與這支健檢看到的是同一句,方向永遠一樣:0 個東西
 * 不是好消息,是掃描器沒在掃。
 */
export const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/**
 * 一行的清點摘要,形狀比照 check-boundaries 的
 * 「boundaries: 掃描 195 個檔案,允許例外 11 條」。
 *
 * 沒有這一行的時候,25 張卡的 vault 與空目錄印出來的字一模一樣——那正是
 * P-28 要修的東西。數字要能自己動,所以全部來自 inventory() 的實際清點。
 */
export function formatScanSummary(inv: DirInventory): string {
  const deps = inv.depsFile ? 'graph/deps.json 有' : 'graph/deps.json 缺';
  const order = `graph/order-*.json ${inv.orderFiles.length} 份`;
  return `lint: 掃描 ${inv.categories.length} 個類別,${inv.cards} 張卡,${inv.questions} 份考題;${deps},${order}`;
}

/**
 * 0 張卡的診斷。三種「0」的修法完全不同,所以三種輸出必須不一樣:
 *
 *   1. `cards/` 不存在        → 路徑打錯 / 目錄被搬走 / 同步刪掉
 *   2. `cards/` 在但沒有類別  → init 過但還沒 ingest 任何素材
 *   3. 類別目錄裡沒有 .md     → 卡片檔案本身消失,最像「資料不見了」
 *
 * 回傳空陣列代表有卡片、不是這一類的紅。
 */
export function formatZeroCards(root: string, inv: DirInventory): string[] {
  if (inv.cards > 0) return [];

  if (!inv.cardsDirExists) {
    return [
      `✗ lint: 掃描到 0 張卡。cards/ 這個目錄不存在:${join(root, 'cards')}`,
      `${SCANNER_BROKEN}。--dir 指錯地方、目錄被搬走或同步刪掉時就長這樣。`,
    ];
  }

  if (inv.categories.length === 0) {
    return [
      '✗ lint: 掃描到 0 張卡。cards/ 在,但底下一個類別目錄都沒有(0 個類別)。',
      `${SCANNER_BROKEN}。init 過但還沒 ingest 任何素材時就長這樣。`,
    ];
  }

  return [
    `✗ lint: 掃描到 0 張卡。類別目錄 ${inv.emptyCategories.join('、')} 底下沒有任何 .md。`,
    `${SCANNER_BROKEN}。卡片檔案本身消失時就長這樣。`,
  ];
}
