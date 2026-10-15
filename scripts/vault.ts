/**
 * 帳本指標的 bootstrap。
 *
 *   npx tsx scripts/vault.ts init --learning-dir <絕對路徑> [--force]
 *   npx tsx scripts/vault.ts show
 *
 * 兩份檔都走 writeFileAtomic。指標已指向別處時拒絕,除非 --force(先印舊內容)。
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  isUuid,
  markerPath,
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

export interface VaultCommandDeps {
  learningDir: string;
  force?: boolean;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  io: VaultIo;
  randomUUID?: () => string;
}

function readMarkerId(io: VaultIo, learningDir: string): string | undefined {
  const path = markerPath(learningDir);
  if (!io.exists(path)) return undefined;
  const text = io.readFile(path);
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body;
}

function writeMarker(io: VaultIo, learningDir: string, vaultId: string): void {
  const path = markerPath(learningDir);
  io.mkdir(resolve(path, '..'), 0o755);
  io.writeAtomic(path, `${vaultId}\n`);
}

function writePointer(io: VaultIo, pointer: string, learningDir: string, vaultId: string): void {
  io.mkdir(resolve(pointer, '..'), 0o700);
  io.writeAtomic(pointer, `${JSON.stringify({ learning_dir: learningDir, vault_id: vaultId })}\n`);
}

export function initVault(opts: VaultCommandDeps): VaultCommandResult {
  const learningDir = opts.learningDir;
  if (!isAbsolute(learningDir) || !opts.io.exists(learningDir)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `--learning-dir 必須是已存在的絕對路徑。相對路徑或不存在的目錄不會建立任何東西。`,
    };
  }

  const pointer = vaultPointerPath(opts.env, opts.homedir);
  const markerId = readMarkerId(opts.io, learningDir);
  const pointerExists = opts.io.exists(pointer);

  if (!pointerExists) {
    const vaultId = markerId ?? (opts.randomUUID ?? randomUUID)();
    if (!isUuid(vaultId)) {
      return { exitCode: 1, stdout: '', stderr: '標記裡的 uuid 格式不合,拒絕寫指標。' };
    }
    if (markerId === undefined) writeMarker(opts.io, learningDir, vaultId);
    writePointer(opts.io, pointer, learningDir, vaultId);
    return { exitCode: 0, stdout: `已寫入指標 ${pointer}\n`, stderr: '' };
  }

  const oldRaw = opts.io.readFile(pointer);
  let oldDir = '';
  let oldId = '';
  try {
    const parsed = JSON.parse(oldRaw) as { learning_dir?: unknown; vault_id?: unknown };
    if (typeof parsed.learning_dir === 'string') oldDir = parsed.learning_dir;
    if (typeof parsed.vault_id === 'string') oldId = parsed.vault_id;
  } catch {
    oldDir = '';
  }

  const samePlace = oldDir !== '' && resolve(oldDir) === resolve(learningDir);

  if (samePlace && markerId !== undefined && markerId === oldId) {
    return { exitCode: 0, stdout: '已初始化\n', stderr: '' };
  }

  if (!opts.force) {
    if (!samePlace && oldDir !== '') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `指標已指向別處。要覆寫請加 --force。\n`,
      };
    }
    const left = oldId.slice(0, 8);
    const right = (markerId ?? '').slice(0, 8);
    return {
      exitCode: 1,
      stdout: '',
      stderr: `指標與標記的 id 不符。指標前 8 碼 ${left},標記前 8 碼 ${right}。要覆寫請加 --force。\n`,
    };
  }

  const vaultId = markerId ?? (opts.randomUUID ?? randomUUID)();
  if (markerId === undefined) writeMarker(opts.io, learningDir, vaultId);
  writePointer(opts.io, pointer, learningDir, vaultId);
  return {
    exitCode: 0,
    stdout: `${oldRaw}\n已用 --force 覆寫指標\n`,
    stderr: '',
  };
}

export function showVault(opts: Omit<VaultCommandDeps, 'learningDir' | 'force' | 'randomUUID'>): VaultCommandResult {
  const pointer = vaultPointerPath(opts.env, opts.homedir);
  if (!opts.io.exists(pointer)) {
    return {
      exitCode: 1,
      stdout: `pointer: ${pointer}\nlearning_dir: (missing)\nmarker: missing\nmatch: no\n`,
      stderr: '指標檔不存在\n',
    };
  }
  let learningDir = '';
  let vaultId = '';
  try {
    const parsed = JSON.parse(opts.io.readFile(pointer)) as { learning_dir?: unknown; vault_id?: unknown };
    if (typeof parsed.learning_dir === 'string') learningDir = parsed.learning_dir;
    if (typeof parsed.vault_id === 'string') vaultId = parsed.vault_id;
  } catch {
    return {
      exitCode: 1,
      stdout: `pointer: ${pointer}\nlearning_dir: (missing)\nmarker: missing\nmatch: no\n`,
      stderr: '指標檔讀不到\n',
    };
  }
  const marker = learningDir !== '' && opts.io.exists(markerPath(learningDir));
  let markerText = '';
  if (marker) markerText = opts.io.readFile(markerPath(learningDir));
  const match = marker && vaultIdsEqual(markerText, vaultId);
  const stdout =
    `pointer: ${pointer}\n` +
    `learning_dir: ${learningDir || '(missing)'}\n` +
    `marker: ${marker ? 'present' : 'missing'}\n` +
    `match: ${match ? 'yes' : 'no'}\n`;
  return { exitCode: match ? 0 : 1, stdout, stderr: match ? '' : '身分不符\n' };
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const io = realVaultIo();
  const deps = { env: process.env, homedir: () => homedir(), io };
  const result =
    command === 'show'
      ? showVault(deps)
      : command === 'init'
        ? initVault({
            ...deps,
            learningDir: argValue(argv, '--learning-dir') ?? '',
            force: argv.includes('--force'),
          })
        : { exitCode: 1, stdout: '', stderr: '用法: vault.ts init --learning-dir <abs> [--force] | vault.ts show\n' };
  if (result.stdout) process.stdout.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
