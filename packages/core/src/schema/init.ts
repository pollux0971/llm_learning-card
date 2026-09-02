import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { writeFileAtomic } from './atomic-write.js';

/** 契約 §12 目錄結構,phase-1 負責建立的部分 */
const DIRS = ['raw', 'cards', 'questions', 'assets', 'state', 'graph', 'config'] as const;

/** 契約 §11 Settings 的預設值 */
export const DEFAULT_SETTINGS = {
  daily_cap: 10,
  weekly_target: 7,
  short_body_limit: 50,
  llm: {
    cloud_provider: 'anthropic',
    cloud_model: 'claude-sonnet-4-6',
    local_model: 'qwen2.5:14b',
  },
} as const;

export interface InitResult {
  /** 這次執行實際建立的目錄(含尾斜線)與檔案的相對路徑 */
  created: string[];
  /** 已存在因此沒有動的檔案相對路徑 */
  skipped: string[];
}

/** ISO 8601 週數,"YYYY-Wnn" */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 週一 = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 移到本週四
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * 初始化 learning/ 目錄樹。冪等:已存在的目錄/檔案一律不動
 * (「Initialising twice does not overwrite」)。
 */
export function initLearningDir(dir: string, opts: { today?: Date } = {}): InitResult {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const name of DIRS) {
    const p = join(dir, name);
    if (existsSync(p)) {
      skipped.push(`${name}/`);
    } else {
      mkdirSync(p, { recursive: true });
      created.push(`${name}/`);
    }
  }

  /** 一般檔案(graph/、config/):直接寫。 */
  const writeIfAbsent = (relPath: string, content: string): void => {
    const p = join(dir, relPath);
    if (existsSync(p)) {
      skipped.push(relPath);
      return;
    }
    writeFileSync(p, content, 'utf8');
    created.push(relPath);
  };

  /** state/ 底下的檔案:硬規則 5,tmp → fsync → rename。 */
  const writeStateIfAbsent = (relPath: string, content: string): void => {
    const p = join(dir, relPath);
    if (existsSync(p)) {
      skipped.push(relPath);
      return;
    }
    writeFileAtomic(p, content);
    created.push(relPath);
  };

  writeStateIfAbsent('state/reviews.json', `${JSON.stringify({}, null, 2)}\n`);

  const week = isoWeek(opts.today ?? new Date());
  const weekly = { week, target: DEFAULT_SETTINGS.weekly_target, learned: 0, passed_d1: 0, counted: [] as string[] };
  writeStateIfAbsent('state/weekly.json', `${JSON.stringify(weekly, null, 2)}\n`);

  writeIfAbsent('graph/deps.json', `${JSON.stringify({}, null, 2)}\n`);
  writeIfAbsent('config/categories.yaml', yamlStringify([]));
  writeIfAbsent('config/settings.yaml', yamlStringify(DEFAULT_SETTINGS));

  return { created, skipped };
}
