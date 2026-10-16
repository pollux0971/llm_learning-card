/**
 * T22 驗收 5 的靜態檢查:`commands.rs` 的 `review` command 與 `review_sidecar.rs` 的行程管理做法。
 * 紅測試作者寫;開發 worker 不改。行為(生命週期、busy、逾時)由 src-tauri/tests/review_sidecar.rs 量。
 *
 * `main.rs` 的接線(`.manage(SidecarHost…)`、`RunEvent::Exit` 收掉側車)要等 T21 第 3 輪合併、main.rs 定下來之後再補測試;
 * 這份先不碰 main.rs。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src-tauri/src');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (name: string): string => strip(readFileSync(join(SRC, name), 'utf8'));

/** 拿到 `#[tauri::command]` 後面那個 fn 的整個簽名(到 `{` 為止) */
export function commandSignature(code: string, name: string): string | undefined {
  const re = new RegExp(`#\\[\\s*tauri::command\\s*\\][^{]*?\\bfn\\s+${name}\\b[^{]*`, 's');
  return re.exec(code)?.[0];
}

describe('commands.rs:review command(驗收 5)', () => {
  it('有一個 #[tauri::command] fn review,收 request: serde_json::Value,回 Result<serde_json::Value, ReviewError>', () => {
    const sig = commandSignature(read('commands.rs'), 'review');
    expect(sig, 'commands.rs 沒有 #[tauri::command] … fn review').toBeDefined();
    expect(sig).toMatch(/request\s*:\s*(?:serde_json::)?Value\b/);
    expect(sig).toMatch(/Result\s*<\s*(?:serde_json::)?Value\s*,\s*(?:\w+::)*ReviewError\s*>/);
  });

  it('commands::handler() 的清單含 review,而且原來的四個還在', () => {
    const code = read('commands.rs');
    const list = /generate_handler!\s*\[([^\]]*)\]/.exec(code)?.[1] ?? '';
    const names = list.split(',').map((s) => s.trim().split('::').pop()!).filter((s) => s !== '');
    expect(names.sort()).toEqual(['exists', 'list', 'read', 'review', 'write']);
  });

  it('量尺自測:抓得到沒有 command、簽名不對、清單少一個', () => {
    expect(commandSignature('fn review() {}', 'review')).toBeUndefined();
    expect(commandSignature('#[tauri::command]\nasync fn review(request: Value) -> Result<Value, E> {', 'review')).toMatch(/request: Value/);
    expect(commandSignature('#[tauri::command]\nfn read() {}\n#[tauri::command]\nfn review(a: u8) {', 'review')).toMatch(/a: u8/);
  });
});

describe('review_sidecar.rs:行程的管法(驗收 5)', () => {
  const code = (): string => read('review_sidecar.rs');

  it('子行程的環境先 env_clear 再逐一帶入(白名單),不是繼承再刪', () => {
    expect(code()).toMatch(/\.env_clear\s*\(\s*\)/);
  });

  it('stdin / stdout / stderr 都接管(Stdio::piped),不讓側車直接寫到 app 的 stdout', () => {
    const c = code();
    expect(c.match(/Stdio::piped\s*\(\s*\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('收乾淨:有 kill 也有 wait(不留孤兒、不留殭屍)', () => {
    const c = code();
    expect(c).toMatch(/\.kill\s*\(\s*\)/);
    expect(c).toMatch(/\.wait\s*\(\s*\)/);
  });

  it('不開網路埠:沒有 TcpListener / UdpSocket / hyper / axum / tiny_http', () => {
    expect(code()).not.toMatch(/TcpListener|UdpSocket|tiny_http|hyper|axum/);
  });

  it('stderr 每一行加 [review-sidecar] 前綴再轉出去;非協定行只記一行固定的字', () => {
    const c = code();
    expect(c).toContain('[review-sidecar]');
    expect(c).toContain('dropped non-protocol line');
  });
});
