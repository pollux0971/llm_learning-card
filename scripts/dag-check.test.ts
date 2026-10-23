/**
 * 13-work-dag phase-2(工單 T39)的 `npm run dag:check` 測試:接線、真 repo、先證明會紅。測試 agent(-5c)寫;開發 worker 不改。
 *
 * `dag:check` 的實作是 `scripts/dag.ts --check`(phase-2.feature 最後一個場景釘死:npm script 跑 dag 工具並帶 check 旗標)。
 * 實作者可以另外加 `scripts/dag-check.ts`(例如薄薄的包裝),這個檔不綁它的匯出名:只認 package.json 的 npm script 字串與 CLI 行為。
 * 規則本身(R1–R5、檔頭、落點)的單元測試在 scripts/dag.test.ts 的 phase-2 區;這裡只管「接進去了、而且接的是會紅的那條」。
 *
 * 這個檔是新增的 scripts/*.test.ts,要登記進 scripts/boundaries.owners.json(→ 13-work-dag):在 worker 做完工單第 2 步之前,
 * `npm run boundaries` 會因為它沒登記而紅 —— 那是設計(工單 must_catch:新增檔沒登記 → boundaries 必須紅)。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as P2 from '../features/support/dag-p2-harness.js';

const REPO = resolve(import.meta.dirname, '..');
const scratch: string[] = [];
const mk = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dag-check-'));
  scratch.push(d);
  mkdirSync(join(d, 'features'), { recursive: true });
  return d;
};
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const pkg = (): { scripts: Record<string, string> } => JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const gates = (): { chain: string[] } => JSON.parse(readFileSync(join(REPO, 'scripts/gates.config.json'), 'utf8')) as { chain: string[] };
const owners = (): [string, string][] => (JSON.parse(readFileSync(join(REPO, 'scripts/boundaries.owners.json'), 'utf8')) as { owners: [string, string][] }).owners;

/** npm script 字串 → 可以直接 spawn 的 [node 參數],並把 --root 換成指定的樹。只接受 `tsx scripts/dag*.ts … --check` 這種單一指令 */
function scriptArgs(root: string): string[] {
  const cmd = pkg().scripts['dag:check'] ?? '';
  expect(cmd, 'package.json 沒有 dag:check').not.toBe('');
  expect(cmd, '單一指令(不接 && / ;)').not.toMatch(/&&|;|\|/);
  const words = cmd.split(/\s+/).filter((w) => w !== '');
  expect(words[0], 'dag:check 用 tsx 跑').toBe('tsx');
  const rest = words.slice(1);
  const at = rest.indexOf('--root');
  if (at >= 0) rest.splice(at, 2, '--root', root);
  else rest.push('--root', root);
  return rest;
}
function runScript(root: string): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [P2.TSX_CLI, ...scriptArgs(root)], { cwd: REPO, encoding: 'utf8', env, timeout: 90_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('dag:check 接線(must_catch:dag:check 沒接進 chain)', () => {
  it('package.json 有 npm script dag:check,跑 scripts/dag.ts 並帶 --check', () => {
    const cmd = pkg().scripts['dag:check'];
    expect(cmd, 'package.json 沒有 dag:check').toBeTypeOf('string');
    expect(cmd).toMatch(/scripts\/dag\.ts/);
    expect(cmd).toMatch(/(^|\s)--check(\s|$)/);
  });

  it('scripts/gates.config.json 的 chain 有 dag:check,而且只有一個;chain 裡每一條都是 package.json 的 npm script', () => {
    const chain = gates().chain;
    expect(chain.filter((c) => c === 'dag:check')).toHaveLength(1);
    const scripts = pkg().scripts;
    for (const name of chain) expect(scripts[name], `chain 裡的 ${name} 不是 npm script`).toBeTypeOf('string');
  });
});

describe('先證明會紅,才接進 chain(must_catch:接了但故意弄壞輸入時不紅)', () => {
  it('npm script 實際跑的那條指令:乾淨的樹 → 退出碼 0', () => {
    const root = mk();
    P2.writeLanding(root, P2.FEATURE_LANDING);
    P2.writeTicket(root, { id: 'T1', touches: 'docs/a/', status: 'todo' });
    const r = runScript(root);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('gate=dag result=OK');
  }, 120_000);

  it('缺檔頭的工單檔 → 退出碼 1,PROBLEM missing-header', () => {
    const root = mk();
    P2.writeLanding(root, P2.FEATURE_LANDING);
    P2.writeRaw(root, 'docs/tickets/T7-old.md', '# 沒有檔頭\n');
    const r = runScript(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PROBLEM missing-header T7-old.md');
  }, 120_000);

  it('工單之間有環 → 退出碼 1,PROBLEM cycle', () => {
    const root = mk();
    P2.writeLanding(root, P2.FEATURE_LANDING);
    P2.writeTicket(root, { id: 'T1', deps: 'T2', touches: 'docs/a/' });
    P2.writeTicket(root, { id: 'T2', deps: 'T1', touches: 'docs/b/' });
    const r = runScript(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PROBLEM cycle T1 -> T2 -> T1');
  }, 120_000);

  it('dispatched 的工單違反 R2 → 退出碼 1,PROBLEM r2-overlap', () => {
    const root = mk();
    P2.writeLanding(root, P2.FEATURE_LANDING);
    P2.writeTicket(root, { id: 'T1', touches: 'apps/desktop/src-tauri/', status: 'dispatched' });
    P2.writeTicket(root, { id: 'T2', touches: 'apps/desktop/src/', status: 'dispatched' });
    const r = runScript(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PROBLEM r2-overlap T1 T2 on 10-desktop-shell');
  }, 120_000);

  it('dispatched 的工單違反 R3(兩張 heavy)→ 退出碼 1', () => {
    const root = mk();
    P2.writeLanding(root, P2.FEATURE_LANDING);
    P2.writeTicket(root, { id: 'T1', touches: 'docs/a/', status: 'dispatched', cpu: 'heavy' });
    P2.writeTicket(root, { id: 'T2', touches: 'scripts/b.ts', status: 'review', cpu: 'heavy' });
    expect(runScript(root).status).toBe(1);
  }, 120_000);
});

describe('真 repo(工單第 2、4 步的結果;worker 做完前必須紅)', () => {
  const real = (...flags: string[]) => P2.runDagCli(['--root', REPO, ...flags]);

  /** 暫存樹:真的落點表 + T39 檔頭的複本,status 強制 todo(只有沒結束的工單才印 LANDING,解讀 8);跟 T39 現在的 status 無關 */
  const t39Tree = (touches?: string): string => {
    const root = mk();
    const ticket = readFileSync(join(REPO, 'docs/tickets/T39-work-dag-phase-2.md'), 'utf8');
    const lines = ticket.split('\n');
    const close = lines.indexOf('---', 1);
    expect(lines[0], 'T39 工單第一行是 ---').toBe('---');
    expect(close, 'T39 工單有檔頭結尾').toBeGreaterThan(0);
    let header = lines.slice(0, close + 1).join('\n');
    header = header.replace(/^status:.*$/m, 'status: todo');
    if (touches !== undefined) header = header.replace(/^touches:.*$/m, `touches: ${touches}`);
    P2.writeRaw(root, 'docs/tickets/T39-work-dag-phase-2.md', `${header}\n`);
    P2.writeRaw(root, 'scripts/boundaries.owners.json', readFileSync(join(REPO, 'scripts/boundaries.owners.json'), 'utf8'));
    return root;
  };

  it('T39 檔頭的 touches 全部對得到真落點表(T39 的 status 強制 todo):有 LANDING T39 行,沒有 PROBLEM no-landing T39', () => {
    const r = P2.runDagCli(['--root', t39Tree()]);
    expect(r.status, r.stderr).toBe(0);
    expect(P2.startsWith(r.stdout, 'LANDING T39 ').length, `沒有 LANDING T39 行(工具沒把工單進圖?)\n${r.stdout.slice(0, 600)}`).toBeGreaterThan(0);
    expect(P2.startsWith(r.stdout, 'PROBLEM no-landing T39 ')).toEqual([]);
  }, 120_000);

  it('上一條會抓東西:同一棵暫存樹把 touches 換成沒登記的路徑 → 印 PROBLEM no-landing T39', () => {
    const r = P2.runDagCli(['--root', t39Tree('[zzz-unregistered/file.ts]')]);
    expect(P2.startsWith(r.stdout, 'PROBLEM no-landing T39 ').length, r.stdout.slice(0, 600)).toBeGreaterThan(0);
  }, 120_000);

  it('真 repo 沒有任何 PROBLEM no-landing(還沒結束的工單 touches 都登記在落點表;沒有未結束的工單也成立)', () => {
    const r = real();
    expect(r.status, r.stderr).toBe(0);
    expect(P2.startsWith(r.stdout, 'PROBLEM no-landing')).toEqual([]);
  }, 120_000);

  it('真 repo 每張工單都有合法檔頭:沒有 PROBLEM bad-header / missing-header', () => {
    const r = real();
    expect(r.status, r.stderr).toBe(0);
    expect(P2.startsWith(r.stdout, 'PROBLEM bad-header')).toEqual([]);
    expect(P2.startsWith(r.stdout, 'PROBLEM missing-header')).toEqual([]);
  }, 120_000);

  it('npx tsx scripts/dag.ts --root . --check:退出碼 0,摘要行 gate=dag result=OK … problems=0', () => {
    const r = real('--check');
    expect(r.status, r.stdout.split('\n').filter((l) => l.startsWith('PROBLEM')).join('\n')).toBe(0);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toMatch(/^gate=dag result=OK ready=\d+ blocked=\d+ human=\d+ problems=0$/);
  }, 120_000);

  it('npm script dag:check 實際指令在真 repo 上綠', () => {
    const cmd = pkg().scripts['dag:check'] ?? '';
    expect(cmd).not.toBe('');
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const words = cmd.split(/\s+/).filter((w) => w !== '');
    expect(words[0]).toBe('tsx');
    const args = words.slice(1);
    const at = args.indexOf('--root');
    if (at < 0) args.push('--root', REPO);
    const r = spawnSync(process.execPath, [P2.TSX_CLI, ...args], { cwd: REPO, encoding: 'utf8', env, timeout: 90_000 });
    expect(r.status, r.stdout).toBe(0);
  }, 120_000);

  it('真樹上 WARN 只是資訊:R5 / R4 的 WARN 不讓退出碼變 1(工單第 5 點:量值寫報告)', () => {
    const r = real('--check');
    for (const w of P2.startsWith(r.stdout, 'WARN ')) expect(w).toMatch(/^WARN (r5-depth \S+ \d+|r4-dispatched \d+)$/);
    expect(r.status).toBe(0);
  }, 120_000);
});

describe('登記(must_catch:新增檔沒登記 owners 與 zero-input-roster)', () => {
  const landing = (file: string): string[] => owners().filter(([prefix]) => prefix === file).map(([, o]) => o);

  it('owners:scripts/dag-check.test.ts → 13-work-dag(這個檔自己)', () => {
    expect(landing('scripts/dag-check.test.ts')).toEqual(['13-work-dag']);
  });

  it('owners:scripts/dag-check.ts 若存在 → 13-work-dag;零輸入名冊也要提到它', () => {
    if (!existsSync(join(REPO, 'scripts/dag-check.ts'))) return;
    expect(landing('scripts/dag-check.ts')).toEqual(['13-work-dag']);
    expect(readFileSync(join(REPO, 'scripts/zero-input-roster.ts'), 'utf8')).toMatch(/['"]scripts\/dag-check\.ts['"]/);
  });

  it('落點表要涵蓋這張工單 touches 的每個路徑(最長前綴或目錄涵蓋都行):docs/tickets/、package.json、scripts/gates.config.json、features/13-work-dag/FEATURE.md、features/13-work-dag/NEXT.md', () => {
    const rows = owners();
    for (const touch of ['docs/tickets/', 'package.json', 'scripts/gates.config.json', 'scripts/boundaries.owners.json', 'scripts/zero-input-roster.ts', 'features/13-work-dag/FEATURE.md', 'features/13-work-dag/NEXT.md']) {
      const hit = rows.some(([prefix]) => touch.startsWith(prefix) || (touch.endsWith('/') && prefix.startsWith(touch)));
      expect(hit, `落點表沒有涵蓋 ${touch}`).toBe(true);
    }
  });
});
