/**
 * T2c-1 驗收 A1:四個 `#[tauri::command]` 的本體只有一行,呼叫 probe(src/bin/lc-fs.rs)用的同一個 learning_fs 函式。
 * 也檢查 Rust 測試放在獨立檔(acceptance-sop:「Rust 測試放獨立檔」),本張動到的實作檔裡沒有 `#[cfg(test)]`。
 * 測試 agent 寫的;實作者不要改。行為面(拒絕、io 錯誤)在 src-tauri/tests/commands.rs。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src-tauri/src');
const COMMANDS = join(SRC, 'commands.rs');
const PROBE = join(SRC, 'bin/lc-fs.rs');

function stripRustComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

interface CommandFn {
  name: string;
  body: string;
}

/** 每個 `#[tauri::command]` 後面那個 fn 的名字與 `{ … }` 裡面的文字。 */
function commandFns(src: string): CommandFn[] {
  const code = stripRustComments(src);
  const out: CommandFn[] = [];
  const re = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const m of code.matchAll(re)) {
    const name = m[1]!;
    const open = code.indexOf('{', (m.index ?? 0) + m[0].length);
    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (open < 0 || end < 0) throw new Error(`command ${name} 的本體沒有配對的括號`);
    out.push({ name, body: code.slice(open + 1, end).trim() });
  }
  return out;
}

describe('the four Tauri commands are one line each(A1)', () => {
  it('src-tauri/src/commands.rs exists', () => {
    expect(existsSync(COMMANDS), 'apps/desktop/src-tauri/src/commands.rs').toBe(true);
  });

  it('there are exactly four commands: read, write, list, exists', () => {
    const names = commandFns(readFileSync(COMMANDS, 'utf8')).map((c) => c.name).sort();
    expect(names).toEqual(['exists', 'list', 'read', 'write']);
  });

  it('each body is a single expression that calls one learning_fs function, the same one the probe calls', () => {
    const probe = stripRustComments(readFileSync(PROBE, 'utf8'));
    for (const cmd of commandFns(readFileSync(COMMANDS, 'utf8'))) {
      expect(cmd.body.includes(';'), `${cmd.name}: more than one statement: ${cmd.body}`).toBe(false);
      expect(/\b(let|if|match|for|while|loop)\b/.test(cmd.body), `${cmd.name}: logic in the command body: ${cmd.body}`).toBe(false);
      const calls = [...cmd.body.matchAll(/\blearning_fs::([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]);
      expect(calls, `${cmd.name}: must call exactly one learning_fs function: ${cmd.body}`).toHaveLength(1);
      expect(probe, `${cmd.name}: the probe must call learning_fs::${calls[0]} too`).toContain(`learning_fs::${calls[0]}(`);
      expect(/\b(std::fs|fs::|File::|OpenOptions|read_to_string|path_guard::)/.test(cmd.body), `${cmd.name}: touches fs or the guard directly: ${cmd.body}`).toBe(
        false,
      );
    }
  });

  it('the parser itself sees a body with two statements', () => {
    const fns = commandFns('#[tauri::command]\npub fn read(a: u8) -> u8 {\n  let x = 1;\n  x + a\n}\n');
    expect(fns).toEqual([{ name: 'read', body: 'let x = 1;\n  x + a' }]);
  });
});

describe('Rust tests live in their own files', () => {
  it.each(['learning_fs.rs', 'path_guard.rs', 'asset_protocol.rs', 'commands.rs', 'event_log.rs'])('src/%s has no #[cfg(test)]', (file) => {
    const path = join(SRC, file);
    if (!existsSync(path)) return;
    expect(readFileSync(path, 'utf8')).not.toMatch(/#\[cfg\(test\)\]/);
  });
});
