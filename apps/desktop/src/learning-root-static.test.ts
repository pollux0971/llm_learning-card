/**
 * T2c-2 的靜態檢查(測試 agent 寫):learning 根目錄只有一個來源、桌面程式只讀、兩個自我回報函式已刪、default-run。
 *
 * 只讀原始碼與 `cargo metadata`,不編譯、不跑 probe。
 * 「非測試程式碼」= src-tauri/src 底下去掉註解與 `#[cfg(test)]` 區塊之後的 Rust。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const DESKTOP = join(import.meta.dirname, '..');
const SRC_TAURI = join(DESKTOP, 'src-tauri');
const RUST_SRC = join(SRC_TAURI, 'src');
const TS_SRC = join(DESKTOP, 'src');

function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target') continue;
      out.push(...listFiles(full, ext));
    } else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 去掉註解與 `#[cfg(test)]` 後面的那個 `mod … { … }`(大括號配對)。字串裡的 `//` 不處理——這些檔沒有那種字串。 */
function stripNonProduction(source: string): string {
  let s = source.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  for (;;) {
    const at = s.search(/#\[cfg\(test\)\]/);
    if (at < 0) break;
    const open = s.indexOf('{', at);
    if (open < 0) {
      s = s.slice(0, at);
      break;
    }
    let depth = 0;
    let end = open;
    for (; end < s.length; end++) {
      if (s[end] === '{') depth++;
      else if (s[end] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    s = s.slice(0, at) + s.slice(end + 1);
  }
  return s;
}

function production(): { file: string; code: string }[] {
  return listFiles(RUST_SRC, '.rs').map((f) => ({ file: relative(SRC_TAURI, f), code: stripNonProduction(readFileSync(f, 'utf8')) }));
}

describe('單一來源(工單驗收 4)', () => {
  it('非測試程式碼裡 LC_LEARNING_ROOT 零命中', () => {
    const hits = production().filter((p) => p.code.includes('LC_LEARNING_ROOT'));
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it('lib 不再有從環境變數拿根目錄的 configured_root', () => {
    const hits = production().filter((p) => /\bconfigured_root\b/.test(p.code));
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it('不用 Tauri 的 app_config_dir 或平台設定目錄套件找指標檔', () => {
    const hits = production().filter((p) => /app_config_dir|\bconfig_dir\s*\(|\bdirs::|\bdirectories::/.test(p.code));
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it('src/learning_root.rs 存在,而且指標檔與標記檔的名字只寫在那裡', () => {
    const file = join(RUST_SRC, 'learning_root.rs');
    expect(existsSync(file), 'src/learning_root.rs 不存在').toBe(true);
    const code = stripNonProduction(readFileSync(file, 'utf8'));
    expect(code).toContain('vault.json');
    expect(code).toContain('vault-id');
    expect(code).toContain('llm-learning-cards');
    const others = production().filter((p) => p.file !== join('src', 'learning_root.rs') && /vault\.json|vault-id|llm-learning-cards/.test(p.code));
    expect(others.map((o) => o.file), '指標檔路徑只能有一個地方定義').toEqual([]);
  });

  it('解析只在 main.rs 做一次;command、lc 協定、learning_fs 都不自己讀指標檔(共用 Tauri state 那一份)', () => {
    const files = production();
    const callsOf = (name: string): number => {
      const f = files.find((p) => p.file === join('src', name));
      return (f?.code.match(/learning_root::(resolve|resolve_at|pointer_path)\s*\(/g) ?? []).length;
    };
    expect(callsOf('main.rs')).toBe(1);
    for (const name of ['commands.rs', 'asset_protocol.rs', 'learning_fs.rs', 'event_log.rs']) {
      expect(callsOf(name), `${name} 不該自己解析根目錄`).toBe(0);
    }
  });

  it('T2b 的 node:fs 設定檔 startup.ts 不再被 app 使用(刪掉,或搬到 test-support)', () => {
    expect(existsSync(join(TS_SRC, 'startup.ts')), 'apps/desktop/src/startup.ts 還在').toBe(false);
    const importers = listFiles(TS_SRC, '.ts')
      .concat(listFiles(TS_SRC, '.svelte'))
      .filter((f) => !relative(TS_SRC, f).startsWith('test-support'))
      .filter((f) => !f.endsWith('.test.ts'))
      .filter((f) => /from\s+['"][^'"]*\/startup(\.js)?['"]|import\s*\(\s*['"][^'"]*\/startup(\.js)?['"]/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => relative(TS_SRC, f))).toEqual([]);
  });
});

describe('桌面程式不寫指標檔與身分標記(工單驗收 5)', () => {
  const WRITE_API =
    /fs::write|File::create|create_new\s*\(|OpenOptions|fs::rename|\.write_all\s*\(|\.write\s*\(|remove_file|remove_dir|create_dir|set_permissions|atomic_write|fs::copy|\.set_len\s*\(|\.truncate\s*\(|symlink\s*\(/;

  it('提到 vault.json 或 vault-id 的非測試檔,沒有任何寫入用的 API', () => {
    const mentioning = production().filter((p) => /vault\.json|vault-id/.test(p.code));
    expect(mentioning.length, '至少 learning_root.rs 要提到它們').toBeGreaterThan(0);
    const writers = mentioning.filter((p) => WRITE_API.test(p.code));
    expect(writers.map((w) => w.file)).toEqual([]);
  });

  it('learning_root.rs 沒有 mkdir 之類的副作用', () => {
    const file = join(RUST_SRC, 'learning_root.rs');
    expect(existsSync(file)).toBe(true);
    const code = stripNonProduction(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(WRITE_API);
  });
});

describe('兩個自我回報函式已刪(工單驗收 8)', () => {
  it('src-tauri/src 裡 same_checks_as_read 與 scope_is_learning_root 零命中', () => {
    const all = listFiles(RUST_SRC, '.rs').filter((f) => /same_checks_as_read|scope_is_learning_root/.test(readFileSync(f, 'utf8')));
    expect(all.map((f) => relative(SRC_TAURI, f))).toEqual([]);
  });

  it('src/main.rs 真的註冊了 lc 協定(取代寫死的 custom_enabled: Some(true))', () => {
    const main = readFileSync(join(RUST_SRC, 'main.rs'), 'utf8');
    expect(main).toMatch(/\.register_uri_scheme_protocol\(\s*SCHEME\s*,/);
    const probe = readFileSync(join(RUST_SRC, 'bin', 'lc-fs.rs'), 'utf8');
    expect(probe).not.toMatch(/custom_enabled/);
  });
});

describe('npm run tauri dev 照原文能跑(工單驗收 9,靜態部分)', () => {
  it('cargo metadata 裡這個 package 的 default_run 是 learning-cards-desktop', () => {
    const r = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], {
      cwd: SRC_TAURI,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(r.status, `${r.stderr}`).toBe(0);
    const meta = JSON.parse(r.stdout) as { packages: { name: string; default_run: string | null; targets: { name: string; kind: string[] }[] }[] };
    const pkg = meta.packages.find((p) => p.name === 'learning-cards-desktop');
    expect(pkg, '找不到 package').toBeDefined();
    expect(pkg?.default_run).toBe('learning-cards-desktop');
    // 兩個 bin 都還在(probe 沒被改名或刪掉)
    const bins = pkg?.targets.filter((t) => t.kind.includes('bin')).map((t) => t.name).sort();
    expect(bins).toEqual(['lc-fs', 'learning-cards-desktop']);
  });
});
