/**
 * 帳本指標的 bootstrap(T5 / ADR-066,契約 §12 1.4.0)。
 *
 *   npx tsx scripts/vault.ts init --learning-dir <絕對路徑> [--force]
 *   npx tsx scripts/vault.ts show
 *
 * `init` 建立帳本身分標記 `<learning_dir>/config/vault-id` 與使用者層指標
 * `${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json`;兩份檔都走原子寫入(暫存檔 → fsync → rename)。
 *
 * | 情境 | `init` |
 * |---|---|
 * | 無指標、無標記 | 產生 uuid,寫標記與指標,exit 0 |
 * | 有標記、無指標 | 沿用標記的 uuid 寫指標(不重新產生),exit 0 |
 * | 指標指向同一處且 id 相符 | 不改任何檔,exit 0,印「已初始化」 |
 * | 指標指向別處 / 讀不到 / 與標記不符 | 拒絕,不改任何檔,exit 1,說要 `--force`;不符時只印兩邊的前 8 碼 |
 * | 以上再加 `--force` | 先印出舊指標的內容(明示的丟棄,要讓人看見丟了什麼,ADR-050),再覆寫 |
 * | `--learning-dir` 相對或不存在 | 拒絕,不建任何東西 |
 * | 標記內容不是合法 uuid | 拒絕(加 `--force` 也一樣):帳本身分壞了,要人看,不自動換掉 |
 *
 * 標記是帳本本身的身分:有標記時一律沿用它,指標跟著標記走;只有沒有標記時才產生新的 uuid。
 * `show` 印出指標位置、`learning_dir`、標記是否存在、是否相符;任何不符 exit 1。
 *
 * 這支只碰呼叫端給的 env / homedir / io——測試全部注入 mkdtemp 的值。真的 `learning/` 只由協調者
 * 在合併後跑一次 `init`(工單 T5 第 19、20 條)。
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  markerPath,
  parseMarker,
  parsePointer,
  realVaultIo,
  vaultIdsEqual,
  vaultPointerPath,
  type VaultIo,
} from '../packages/core/src/llm/ledger.js';

export type { VaultIo };

export interface VaultCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface VaultShowDeps {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  io: VaultIo;
}

export interface VaultInitDeps extends VaultShowDeps {
  learningDir: string;
  force?: boolean;
  /** 測試注入;預設 crypto.randomUUID */
  randomUUID?: () => string;
}

const USAGE = '用法:npx tsx scripts/vault.ts init --learning-dir <絕對路徑> [--force] | npx tsx scripts/vault.ts show';

function fail(stderr: string): VaultCommandResult {
  return { exitCode: 1, stdout: '', stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n` };
}

function prefix8(id: string): string {
  return id.slice(0, 8);
}

function writeMarker(io: VaultIo, learningDir: string, vaultId: string): void {
  const path = markerPath(learningDir);
  io.mkdir(dirname(path));
  io.writeAtomic(path, `${vaultId}\n`);
}

function writePointer(io: VaultIo, pointer: string, learningDir: string, vaultId: string): void {
  io.mkdir(dirname(pointer), 0o700);
  io.writeAtomic(pointer, `${JSON.stringify({ learning_dir: learningDir, vault_id: vaultId })}\n`);
}

export function initVault(deps: VaultInitDeps): VaultCommandResult {
  const { io } = deps;
  const given = deps.learningDir;
  // 絕對路徑的 resolve 只做正規化(結尾斜線、`..`),不看 cwd。結尾再加 `/` 去探:路徑是檔案時
  // stat 會 ENOTDIR,exists 回 false——只有已存在的目錄過得去。
  if (given === '' || !isAbsolute(given) || !io.exists(`${resolve(given)}/`)) {
    return fail(
      `--learning-dir 必須是已存在的目錄的絕對路徑(收到:${given === '' ? '(沒給)' : given});` +
        `相對路徑、不存在、不是目錄一律拒絕,什麼都不建。\n${USAGE}`,
    );
  }
  const learningDir = resolve(given);
  const pointer = vaultPointerPath(deps.env, deps.homedir);
  const marker = markerPath(learningDir);

  let markerId: string | undefined;
  if (io.exists(marker)) {
    markerId = parseMarker(io.readFile(marker));
    if (markerId === undefined) {
      return fail(
        `帳本身分標記 ${marker} 的內容不是合法的 uuid(config/vault-id)。不會自動換掉帳本身分;請人工檢查這個檔。`,
      );
    }
  }
  const newId = (): string => (deps.randomUUID ?? randomUUID)();

  if (!io.exists(pointer)) {
    const vaultId = markerId ?? newId();
    if (markerId === undefined) writeMarker(io, learningDir, vaultId);
    writePointer(io, pointer, learningDir, vaultId);
    return {
      exitCode: 0,
      stdout: `已建立指標 ${pointer}(${markerId === undefined ? '新的帳本身分' : '沿用既有的帳本身分標記'})\n`,
      stderr: '',
    };
  }

  const oldRaw = io.readFile(pointer);
  const old = parsePointer(oldRaw);
  const samePlace = old.ok && resolve(old.learningDir) === learningDir;

  if (old.ok && samePlace && markerId !== undefined && markerId === old.vaultId) {
    return { exitCode: 0, stdout: `已初始化:${pointer} 指向這個 learning_dir,帳本身分相符,沒有改任何檔。\n`, stderr: '' };
  }

  if (deps.force !== true) {
    if (!old.ok) {
      return fail(`既有的指標檔 ${pointer} 讀不到(${old.detail})。要丟棄它重寫請加 --force(會先印出舊內容)。`);
    }
    if (!samePlace) {
      return fail(`指標檔 ${pointer} 已指向別處:${old.learningDir}。要改指向這裡請加 --force(會先印出舊指標的內容)。`);
    }
    if (markerId === undefined) {
      return fail(
        `指標指向這裡,但帳本身分標記 config/vault-id 不存在(指標 ${prefix8(old.vaultId)})。要重建帳本身分請加 --force。`,
      );
    }
    return fail(
      `指標與標記的 vault_id 不符:指標 ${prefix8(old.vaultId)},標記 ${prefix8(markerId)}。要以標記為準改寫指標請加 --force。`,
    );
  }

  const vaultId = markerId ?? newId();
  const discarded = `舊指標(將被丟棄):\n${oldRaw.endsWith('\n') ? oldRaw : `${oldRaw}\n`}`;
  if (markerId === undefined) writeMarker(io, learningDir, vaultId);
  writePointer(io, pointer, learningDir, vaultId);
  return { exitCode: 0, stdout: `${discarded}已用 --force 覆寫指標 ${pointer}\n`, stderr: '' };
}

export function showVault(deps: VaultShowDeps): VaultCommandResult {
  const { io } = deps;
  const pointer = vaultPointerPath(deps.env, deps.homedir);
  const lines = [`pointer: ${pointer}`];
  const done = (exitCode: number, stderr: string): VaultCommandResult => ({
    exitCode,
    stdout: `${lines.join('\n')}\n`,
    stderr: stderr === '' ? '' : `${stderr}\n`,
  });

  if (!io.exists(pointer)) {
    lines.push('learning_dir: (no pointer)', 'marker: unknown', 'match: no');
    return done(1, '指標檔不存在。請執行 npx tsx scripts/vault.ts init --learning-dir <絕對路徑>。');
  }
  const parsed = parsePointer(io.readFile(pointer));
  if (!parsed.ok) {
    lines.push('learning_dir: (unreadable)', 'marker: unknown', 'match: no');
    return done(1, `指標檔讀不到:${parsed.detail}`);
  }
  lines.push(`learning_dir: ${parsed.learningDir}`);
  if (!io.exists(parsed.learningDir)) {
    lines.push('marker: missing', 'match: no');
    return done(1, 'learning_dir 不存在。');
  }
  const marker = markerPath(parsed.learningDir);
  if (!io.exists(marker)) {
    lines.push('marker: missing', 'match: no');
    return done(1, '帳本身分標記 config/vault-id 不存在。');
  }
  lines.push('marker: present');
  if (!vaultIdsEqual(io.readFile(marker), parsed.vaultId)) {
    lines.push('match: no');
    return done(1, '帳本身分標記與指標的 vault_id 不符。');
  }
  lines.push('match: yes');
  return done(0, '');
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

/** 入口層:只有這裡拿真的 process.env / os.homedir() / 檔案系統。 */
function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const base: VaultShowDeps = { env: process.env, homedir: () => homedir(), io: realVaultIo() };
  let result: VaultCommandResult;
  try {
    if (command === 'show') result = showVault(base);
    else if (command === 'init')
      result = initVault({ ...base, learningDir: argValue(argv, '--learning-dir') ?? '', force: argv.includes('--force') });
    else result = fail(USAGE);
  } catch (err) {
    result = fail(`vault.ts 失敗:${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
