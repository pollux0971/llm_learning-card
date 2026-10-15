/**
 * 真前端有沒有被載入的靜態檢查(T2c-1 驗收 F17–F18;測試 agent 寫的,實作者不要改)。
 *
 * 不開視窗。讀 tauri.conf.json:
 *   - `build.frontendDist`(相對 src-tauri/)是建置產物的資料夾;
 *   - `build.beforeBuildCommand`(字串,或 `{ script, cwd }`)是建置指令;沒寫 cwd 時在 apps/desktop/ 執行
 *     (Tauri CLI 的預設:含 package.json 的 app 目錄,也就是 src-tauri 的上一層);
 *   - `app.windows[].url` 是兩個視窗要開的 html(相對 frontendDist)。
 * checkFrontendDist 檢查:每個 html 存在;裡面每一個 `<script src>`、`<link href>` 解析後都是 frontendDist 裡存在的檔;
 * 沒有任何被引用的檔以 `.ts` 結尾;沒有外部 URL(CSP 是 'self',外部的一定載不到)。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export const SRC_TAURI = join(import.meta.dirname, '../../src-tauri');
export const APP_DIR = join(import.meta.dirname, '../..');
export const TAURI_CONF = join(SRC_TAURI, 'tauri.conf.json');

export const BUILD_FRONTENDS_TIMEOUT_MS = 300_000;

export interface TauriWindow {
  label: string;
  url?: string;
  [k: string]: unknown;
}

export interface TauriConf {
  build?: {
    frontendDist?: string;
    beforeBuildCommand?: string | { script: string; cwd?: string };
    devUrl?: string;
    [k: string]: unknown;
  };
  app?: {
    windows?: TauriWindow[];
    security?: { csp?: unknown; devCsp?: unknown; [k: string]: unknown };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function readTauriConf(path = TAURI_CONF): TauriConf {
  return JSON.parse(readFileSync(path, 'utf8')) as TauriConf;
}

export function frontendDistDir(conf: TauriConf): string {
  const dist = conf.build?.frontendDist;
  if (typeof dist !== 'string' || dist.length === 0) throw new Error('tauri.conf.json 沒有 build.frontendDist');
  if (/^https?:/.test(dist)) throw new Error(`build.frontendDist 是 URL 不是資料夾: ${dist}`);
  return resolve(SRC_TAURI, dist);
}

export function beforeBuild(conf: TauriConf): { script: string; cwd: string } | undefined {
  const cmd = conf.build?.beforeBuildCommand;
  if (typeof cmd === 'string' && cmd.trim().length > 0) return { script: cmd, cwd: APP_DIR };
  if (cmd && typeof cmd === 'object' && typeof cmd.script === 'string' && cmd.script.trim().length > 0) {
    return { script: cmd.script, cwd: cmd.cwd ? resolve(APP_DIR, cmd.cwd) : APP_DIR };
  }
  return undefined;
}

/** 跑 beforeBuildCommand;失敗就丟錯並附完整輸出。回傳輸出的最後幾行。 */
export function runBeforeBuild(conf: TauriConf): string {
  const cmd = beforeBuild(conf);
  if (!cmd) throw new Error('tauri.conf.json 沒有 build.beforeBuildCommand(驗收 F17)');
  const r = spawnSync('sh', ['-c', cmd.script], { cwd: cmd.cwd, encoding: 'utf8', timeout: BUILD_FRONTENDS_TIMEOUT_MS });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.status !== 0) {
    throw new Error(`beforeBuildCommand 失敗 status=${r.status ?? 'error'} ${r.error?.message ?? ''}\n$ ${cmd.script}\n${output}`);
  }
  return output.split('\n').slice(-5).join('\n');
}

export interface WindowEntry {
  label: string;
  html: string;
}

export function windowEntries(conf: TauriConf): WindowEntry[] {
  return (conf.app?.windows ?? []).map((w) => ({ label: w.label, html: (w.url ?? 'index.html').replace(/[?#].*$/, '') }));
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** html 裡 `<script src>` 與 `<link href>` 的值,依出現順序。 */
export function referencedAssets(html: string): string[] {
  const out: string[] = [];
  const body = stripHtmlComments(html);
  for (const m of body.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of body.matchAll(/<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

function inside(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/** 回傳問題清單;空 = 通過。每一條都寫出是哪個 html、哪個引用。 */
export function checkFrontendDist(distDir: string, htmlFiles: string[]): string[] {
  const problems: string[] = [];
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    return [`frontendDist 不存在或不是資料夾: ${distDir}`];
  }
  for (const htmlRel of htmlFiles) {
    const htmlPath = resolve(distDir, htmlRel);
    if (!inside(distDir, htmlPath)) {
      problems.push(`${htmlRel}: 不在 frontendDist 裡`);
      continue;
    }
    if (!existsSync(htmlPath) || !statSync(htmlPath).isFile()) {
      problems.push(`${htmlRel}: frontendDist 裡沒有這個 html`);
      continue;
    }
    const html = readFileSync(htmlPath, 'utf8');
    for (const ref of referencedAssets(html)) {
      if (ref.length === 0) {
        problems.push(`${htmlRel}: 空的 src/href`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) {
        problems.push(`${htmlRel}: 引用外部 URL ${ref}`);
        continue;
      }
      const clean = ref.replace(/[?#].*$/, '');
      const target = clean.startsWith('/') ? join(distDir, clean) : resolve(dirname(htmlPath), clean);
      const shown = relative(distDir, normalize(target)).split(sep).join('/');
      if (clean.endsWith('.ts')) problems.push(`${htmlRel}: 引用 TypeScript 原始檔 ${ref}`);
      if (!inside(distDir, target)) {
        problems.push(`${htmlRel}: ${ref} 解析到 frontendDist 外面`);
      } else if (!existsSync(target) || !statSync(target).isFile()) {
        problems.push(`${htmlRel}: ${ref} → ${shown} 在 frontendDist 裡不存在`);
      }
    }
  }
  return problems;
}
