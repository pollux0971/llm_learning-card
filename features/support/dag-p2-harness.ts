/**
 * 13-work-dag phase-2(工單 T39)測試的共用小工具。測試 agent 寫;開發 worker 不改。
 * 步驟定義(features/steps/work-dag-phase2.steps.ts)與單元測試(scripts/dag.test.ts、scripts/dag-check.test.ts)共用:
 * 把假樹寫進暫存目錄、起 `scripts/dag.ts` 子行程、比輸出。**不綁實作的匯出名**:只認 CLI(`--root`、`--check`、`--orca`)。
 *
 * 假樹:
 *   <root>/docs/tickets/<id>-example.md        工單檔(檔頭格式見 features/13-work-dag/FEATURE.md)
 *   <root>/scripts/boundaries.owners.json      落點表 `{ "owners": [[前綴, 落點], …] }`
 *   <root>/features/<NN-name>/FEATURE.md|NEXT.md  phase(phase-1 的格式)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const DAG_TS = join(REPO_ROOT, 'scripts/dag.ts');
export const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

/** 合法檔頭的預設值(值是冒號後面的原始 YAML 文字) */
export const DEFAULT_HEADER: Record<string, string> = {
  id: 'T9',
  deps: '[]',
  touches: '[docs/a/]',
  cpu: 'light',
  budget_usd: '1',
  status: 'todo',
  owner: 'worker-grok',
  must_catch: '[]',
};
const FIELD_ORDER = ['id', 'deps', 'touches', 'cpu', 'budget_usd', 'status', 'owner', 'must_catch'];

/** 逗號分隔的格子 → YAML 一行清單;空格子 → `[]` */
export function listText(csv: string): string {
  const items = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return `[${items.join(', ')}]`;
}

/** 檔頭全文(含 `---` 兩行與一段內文)。值是 undefined 的欄位整行省略;`extra` 附在欄位之後 */
export function headerFile(fields: Record<string, string | undefined>, extra = ''): string {
  const lines = FIELD_ORDER.filter((k) => fields[k] !== undefined).map((k) => `${k}: ${fields[k]}`);
  return `---\n${lines.join('\n')}\n${extra}---\n\n# 工單內文\n\n這裡是內文,不是檔頭。\n`;
}

export function ticketFileName(id: string): string {
  return `${id}-example.md`;
}

export function ticketsDir(root: string): string {
  const dir = join(root, 'docs/tickets');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeRaw(root: string, relPath: string, content: string): void {
  const p = join(root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

export interface TicketRow {
  id: string;
  deps?: string;
  touches?: string;
  cpu?: string | undefined;
  status?: string | undefined;
  budget_usd?: string | undefined;
  owner?: string | undefined;
}

/** 蓋一張帶合法檔頭的工單(表裡沒有的欄位用預設:budget_usd 1、owner worker-grok、must_catch []) */
export function writeTicket(root: string, row: TicketRow, fileName?: string): string {
  const file = fileName ?? ticketFileName(row.id);
  writeRaw(
    root,
    `docs/tickets/${file}`,
    headerFile({
      id: row.id,
      deps: listText(row.deps ?? ''),
      touches: listText(row.touches ?? ''),
      cpu: row.cpu ?? 'light',
      budget_usd: row.budget_usd ?? '1',
      status: row.status ?? 'todo',
      owner: row.owner ?? 'worker-grok',
      must_catch: '[]',
    }),
  );
  return file;
}

export function writeLanding(root: string, rows: [string, string][]): void {
  writeRaw(root, 'scripts/boundaries.owners.json', `${JSON.stringify({ owners: rows }, null, 2)}\n`);
}

/** 預設的假落點表(跟 phase-2.feature 的 Background 同一張) */
export const FEATURE_LANDING: [string, string][] = [
  ['contracts/', 'contracts'],
  ['packages/', 'core'],
  ['packages/core/src/scheduler/', '04-scheduler'],
  ['apps/desktop/', '10-desktop-shell'],
  ['scripts/', 'infra'],
  ['docs/', 'docs'],
];

export function addLandingRow(root: string, prefix: string, landing: string): void {
  const path = join(root, 'scripts/boundaries.owners.json');
  const cur = JSON.parse(readFileSync(path, 'utf8')) as { owners: [string, string][] };
  cur.owners.push([prefix, landing]);
  writeFileSync(path, `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
}

export function mkTree(prefix = 'lc-dag-p2'): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** 一個 phase 的假樹(phase-1 的寫法) */
export function writeFeature(root: string, folder: string, rows: [number, string][], next?: string): void {
  const body = rows.map(([n, s]) => `| ${n} | title ${n} | Wave 0 | ${s} | |`).join('\n');
  writeRaw(
    root,
    `features/${folder}/FEATURE.md`,
    `# ${folder}\n\n## Phase\n\n| Phase | 標題 | 階段 | 狀態 | 完成日 |\n|---|---|---|---|---|\n${body}\n`,
  );
  if (next !== undefined) writeRaw(root, `features/${folder}/NEXT.md`, `${next}\n`);
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** 子行程跑 `scripts/dag.ts`(乾淨的 env:去掉 NODE_OPTIONS,cucumber / vitest 自己的載入器不該汙染被測指令) */
export function runDagCli(args: string[], envExtra: Record<string, string> = {}, cwd: string = REPO_ROOT): Run {
  const env = { ...process.env, ...envExtra };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [TSX_CLI, DAG_TS, ...args], { cwd, encoding: 'utf8', env, timeout: 90_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export const linesOf = (stdout: string): string[] => stdout.split('\n');
export const startsWith = (stdout: string, prefix: string): string[] => linesOf(stdout).filter((l) => l.startsWith(prefix));

/** 每個檔(含目錄)的相對路徑 → 內容雜湊;用來比「前後一模一樣」 */
export function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = relative(root, p);
      if (statSync(p).isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(p);
      } else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

/** 建一個放假 `orca` 的目錄:每次被呼叫就把參數附加到記錄檔。回 { dir, log }(PATH 前面放 dir) */
export function makeOrcaStub(base: string): { dir: string; log: string } {
  const dir = join(base, 'stub-bin');
  const log = join(base, 'stub-orca.log');
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'orca');
  writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, 'utf8');
  chmodSync(script, 0o755);
  return { dir, log };
}
export const stubWasCalled = (log: string): boolean => existsSync(log) && readFileSync(log, 'utf8').trim() !== '';

/**
 * `--orca` 印的那一行(T39 工單第 1 點量過的 jq 路徑:`.result.task.id`)。
 * depVars 空 → `--deps "[]"`;否則 `--deps "[\"$T1\",\"$T2\"]"`(逗號後不空格)。
 */
export function orcaLine(id: string, file: string, depVars: string[]): string {
  const deps = depVars.length === 0 ? '[]' : `[${depVars.map((v) => `\\"$${v}\\"`).join(',')}]`;
  return `${id}=$(orca orchestration task-create --spec "$(cat docs/tickets/${file})" --deps "${deps}" --json | jq -r '.result.task.id')`;
}
/** 任何一行 task-create(用來數「建了幾個 task」) */
export const isTaskLine = (l: string): boolean => /^[A-Za-z][A-Za-z0-9_]*=\$\(orca orchestration task-create /.test(l);
