/**
 * 報告本 repo 的模板守門是否跟上游同版。
 *
 * `check:gates` 的 `--check` 只驗證同步後檔案沒有被手改，不能回答模板後來
 * 有沒有出新版本。這支檢查刻意是 report-only：沒有 `$TEMPLATE_DIR` 時仍以
 * rc=0 回報「無法判斷」，但絕不把「不知道」印成「同版」。
 *
 * 用法:
 *   npm run check:template-freshness
 *
 * 版本來源:
 *   - 本 repo: `scripts/_root.ts` 第一行的 `template vX.Y.Z`
 *   - 上游: `$TEMPLATE_DIR/VERSION`
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_root.js';

const GATE_NAME = 'template-freshness';
const LOCAL_ROOT_FILE = 'scripts/_root.ts';

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(raw: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function versionLabel(version: Version): string {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function readLocalVersion(root: string): Version | undefined {
  try {
    const firstLine = readFileSync(join(root, LOCAL_ROOT_FILE), 'utf8').split(/\r?\n/, 1)[0] ?? '';
    const match = /\btemplate\s+v(\d+\.\d+\.\d+)\b/.exec(firstLine);
    return match ? parseVersion(match[1]!) : undefined;
  } catch {
    return undefined;
  }
}

export function readUpstreamVersion(templateDir: string): Version | undefined {
  try {
    return parseVersion(readFileSync(join(templateDir, 'VERSION'), 'utf8'));
  } catch {
    return undefined;
  }
}

function sha256(path: string, stripFirstLine = false): string {
  const content = readFileSync(path);
  if (!stripFirstLine) return createHash('sha256').update(content).digest('hex');
  const firstNewline = content.indexOf(0x0a);
  return createHash('sha256').update(firstNewline < 0 ? Buffer.alloc(0) : content.subarray(firstNewline + 1)).digest('hex');
}

/**
 * 列出升版時預期會變動的同步檔。只比較兩邊都存在、且本地有 SOURCE 標頭的
 * 模板檔，避免把 consumer 自己的 `*.test.ts` 當成模板差異。
 */
export function differingTemplateFiles(root: string, templateDir: string): string[] {
  const localScripts = join(root, 'scripts');
  if (!existsSync(localScripts)) return [];

  const names = ['_root.ts', ...readdirSync(localScripts).filter((name) => /^check-.*\.ts$/.test(name) && !name.endsWith('.test.ts'))];
  return names
    .filter((name) => {
      const localPath = join(localScripts, name);
      const upstreamPath = join(templateDir, 'scripts', name);
      if (!existsSync(localPath) || !existsSync(upstreamPath)) return false;
      const firstLine = readFileSync(localPath, 'utf8').split(/\r?\n/, 1)[0] ?? '';
      return /^\/\/ SOURCE: template v/.test(firstLine) && sha256(localPath, true) !== sha256(upstreamPath);
    })
    .sort();
}

function unknown(reason: string, exitCode = 0): void {
  console.log(`○ 無法判斷(${reason})`);
  console.log(`gate=${GATE_NAME} result=UNKNOWN scanned=2`);
  if (exitCode !== 0) process.exit(exitCode);
}

function main(): void {
  const templateDir = process.env.TEMPLATE_DIR?.trim();
  if (!templateDir) {
    unknown('沒有 $TEMPLATE_DIR');
    return;
  }

  const local = readLocalVersion(ROOT);
  const upstream = readUpstreamVersion(templateDir);
  if (!local || !upstream) {
    unknown('$TEMPLATE_DIR/VERSION 或 scripts/_root.ts 的版本格式無法解析', 1);
    return;
  }

  const comparison = compareVersions(local, upstream);
  if (comparison === 0) {
    console.log(`✓ 守門模板與上游同版(${versionLabel(local)})`);
    console.log(`gate=${GATE_NAME} result=PASS scanned=2`);
    return;
  }

  if (comparison < 0) {
    const distance = local.major === upstream.major && local.minor === upstream.minor ? upstream.patch - local.patch : undefined;
    const behind = distance === undefined ? '版本較舊' : `落後 ${distance} 版`;
    console.log(`○ 上游已到 ${versionLabel(upstream)},我們是 ${versionLabel(local)}(${behind})—— 升版請在沒有 worker 在跑的窗口做`);
    for (const file of differingTemplateFiles(ROOT, templateDir)) console.log(`⚠ ${file} 內容不同`);
    console.log(`gate=${GATE_NAME} result=STALE scanned=2`);
    return;
  }

  console.log(`○ 我們是 ${versionLabel(local)},上游是 ${versionLabel(upstream)}(本 repo 版本較新)`);
  console.log(`gate=${GATE_NAME} result=AHEAD scanned=2`);
}

const isDirectRun = process.argv[1]?.endsWith('check-template-freshness.ts') ?? false;
if (isDirectRun) main();
