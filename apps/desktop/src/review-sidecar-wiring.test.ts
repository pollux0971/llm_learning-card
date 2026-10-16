/**
 * T22 驗收 5 的接線靜態檢查:`main.rs` 把 `SidecarHost` 交給 Tauri 管、關 app 時收掉側車;
 * 子行程的環境與指令來自 `child_env` / `sidecar_command`;`review` command 只轉手、不看內容。
 * 紅測試作者寫;開發 worker 不改。基底含 T21 第 3 輪(main.rs 已定)。
 * 行為(生命週期)由 src-tauri/tests/review_sidecar.rs 量;這裡只看接線。
 *
 * 自測用的片段一律是最小的合成片段(只為了讓量尺的某一個判斷出聲),不放可以直接抄的完整實作。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rustFnBody, stripRustComments } from './test-support/window-frame.js';

const SRC = join(import.meta.dirname, '../src-tauri/src');
const read = (name: string): string => stripRustComments(readFileSync(join(SRC, name), 'utf8'));

/** `needle(` 之後,括號配對到的整段參數文字(字串字面裡的括號不算) */
export function callArgs(code: string, needle: RegExp): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(new RegExp(needle.source, 'g'))) {
    let i = m.index! + m[0].length;
    const from = i;
    let depth = 1;
    for (; i < code.length && depth > 0; i += 1) {
      const ch = code[i]!;
      if (ch === '"') {
        i += 1;
        while (i < code.length && code[i] !== '"') i += code[i] === '\\' ? 2 : 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    out.push(code.slice(from, i - 1));
  }
  return out;
}

/** main.rs 接線的問題清單 */
export function sidecarMainProblems(mainRs: string): string[] {
  const code = stripRustComments(mainRs);
  const problems: string[] = [];
  const main = rustFnBody(code, 'main');
  if (main === undefined) return ['main.rs 找不到 fn main'];
  const managesHost = callArgs(main, /\.manage\s*\(/).some((a) => {
    if (/\bSidecarHost\b/.test(a)) return true;
    // .manage(host) / .manage(Arc::clone(&host)):變數是 SidecarHost::new(...) 的結果
    const id = /^\s*(?:Arc\s*::\s*clone\s*\(\s*&?\s*)?&?([A-Za-z_]\w*)\s*\)?\s*$/.exec(a)?.[1];
    return id !== undefined && new RegExp(`\\blet\\s+(?:mut\\s+)?${id}\\b[^;]*SidecarHost\\s*::\\s*new`).test(main);
  });
  if (!managesHost) problems.push('main() 的 Builder 沒有 .manage(...)  把 SidecarHost 放進 Tauri state');
  const exitAt = main.search(/RunEvent\s*::\s*Exit/);
  if (exitAt < 0) problems.push('main() 沒有處理 RunEvent::Exit');
  else {
    const exitBlock = main.slice(exitAt, exitAt + 1200);
    if (!/\.\s*shutdown\s*\(\s*\)/.test(exitBlock)) problems.push('RunEvent::Exit 的處理裡沒有呼叫 SidecarHost 的 shutdown()(關 app 要收掉側車)');
    if (!/flush_refusals/.test(exitBlock)) problems.push('RunEvent::Exit 裡原本的 flush_refusals 不見了(T2c 的限流補寫不能退步)');
  }
  const specArgs = callArgs(code, /\bchild_env\s*\(/);
  if (specArgs.length === 0) problems.push('main.rs 沒有用 child_env(...) 組子行程的環境');
  else if (!specArgs.some((a) => /^\s*cfg!\s*\(\s*debug_assertions\s*\)\s*,/.test(a))) problems.push('child_env 的第一個參數要是 cfg!(debug_assertions)(release 不帶測試用變數),不是字面 true / false');
  const cmdAt = code.search(/\bsidecar_command\s*\(/);
  if (cmdAt < 0) problems.push('main.rs 沒有用 sidecar_command(...) 決定要跑的程式與參數');
  else if (!/LearningRoot[\s\S]{0,300}\.dir\s*\(/.test(code.slice(Math.max(0, cmdAt - 800), cmdAt + 100))) {
    problems.push('側車的 learning 根要來自 LearningRoot::dir()(啟動只解析一次的那一份),在 sidecar_command 附近找不到');
  }
  if (/\bCommand\s*::\s*new\s*\(/.test(code)) problems.push('main.rs 不直接 Command::new(行程由 review_sidecar 管)');
  return problems;
}

/** commands.rs 的 review command 只轉手:函式本體沒有任何 method / params / result / error 的字串或取值 */
export function reviewCommandProblems(commandsRs: string): string[] {
  const code = stripRustComments(commandsRs);
  const body = rustFnBody(code, 'review');
  if (body === undefined) return ['commands.rs 找不到 fn review'];
  const problems: string[] = [];
  if (/"(method|params|result|error|ok|start|next|submit|summary|status)"/.test(body)) problems.push('review command 的本體出現 method / params / result / error 之類的字串(Rust 不看內容,只轉手)');
  if (/\.get\s*\(|\[\s*"/.test(body)) problems.push('review command 的本體在取 JSON 欄位(Rust 不看內容)');
  if (!/\.call\s*\(/.test(body)) problems.push('review command 的本體沒有呼叫 SidecarHost 的 call(...)');
  return problems;
}

describe('main.rs:SidecarHost 交給 Tauri、關 app 收側車(驗收 5)', () => {
  it('接線齊全:.manage(SidecarHost)、RunEvent::Exit 呼叫 shutdown() 而且原本的 flush_refusals 還在、child_env(cfg!(debug_assertions), …)、sidecar_command、不直接 Command::new', () => {
    expect(sidecarMainProblems(readFileSync(join(SRC, 'main.rs'), 'utf8'))).toEqual([]);
  });

  const ok = `fn main() {
  let host = SidecarHost::new(provider, t);
  let app = Builder::default().manage(LearningRoot::new(r)).manage(host).build();
  let root = app.state::<LearningRoot>().dir();
  let (p, a, c) = sidecar_command(&repo, &root);
  let env = child_env(cfg!(debug_assertions), std::env::vars());
  app.run(move |app, event| { if let RunEvent::Exit = event { app.state::<SidecarHost>().shutdown(); flush_refusals(a, b, c); } });
}
`;
  it('量尺自測:最小片段通過', () => {
    expect(sidecarMainProblems(ok)).toEqual([]);
  });
  it('量尺自測:沒有 manage、Exit 沒收側車、Exit 把 flush_refusals 弄丟、debug 旗標寫死、直接 Command::new → 各自報錯', () => {
    expect(sidecarMainProblems(ok.replace('.manage(host)', '')).join('\n')).toMatch(/\.manage/);
    expect(sidecarMainProblems(ok.replace('app.state::<SidecarHost>().shutdown(); ', '')).join('\n')).toMatch(/shutdown/);
    expect(sidecarMainProblems(ok.replace('flush_refusals(a, b, c);', '')).join('\n')).toMatch(/flush_refusals/);
    expect(sidecarMainProblems(ok.replace('cfg!(debug_assertions)', 'true')).join('\n')).toMatch(/cfg!\(debug_assertions\)/);
    expect(sidecarMainProblems(ok.replace('cfg!(debug_assertions)', 'false')).join('\n')).toMatch(/cfg!\(debug_assertions\)/);
    expect(sidecarMainProblems(ok + '\nfn x() { Command::new("node"); }').join('\n')).toMatch(/Command::new/);
    expect(sidecarMainProblems(ok.replace('let (p, a, c) = sidecar_command(&repo, &root);', '')).join('\n')).toMatch(/sidecar_command/);
    expect(sidecarMainProblems(ok.replace('app.state::<LearningRoot>().dir()', '"/tmp/learning".into()')).join('\n')).toMatch(/LearningRoot::dir\(\)/);
  });
  it('量尺自測:shutdown 寫在 Exit 之外(死在別的函式)不算', () => {
    const wrong = ok.replace('app.state::<SidecarHost>().shutdown(); ', '') + '\nfn other() { h.shutdown(); }';
    expect(sidecarMainProblems(wrong).join('\n')).toMatch(/shutdown/);
  });
  it('量尺自測:註解裡的 .manage / shutdown 不算', () => {
    expect(sidecarMainProblems(ok.replace('.manage(host)', '/* .manage(host) */')).join('\n')).toMatch(/\.manage/);
  });
});

describe('commands.rs:review 只轉手(驗收 5)', () => {
  it('本體沒有 method / params / result 的字串或取值,而且呼叫 call(...)', () => {
    expect(reviewCommandProblems(readFileSync(join(SRC, 'commands.rs'), 'utf8'))).toEqual([]);
  });
  it('量尺自測', () => {
    const good = '#[tauri::command]\nasync fn review(request: Value, host: State<Arc<SidecarHost>>) -> Result<Value, ReviewError> { host.call(&request) }';
    expect(reviewCommandProblems(good)).toEqual([]);
    expect(reviewCommandProblems(good.replace('host.call(&request)', 'if request["method"] == "start" { host.call(&request) } else { host.call(&request) }')).join('\n')).toMatch(/字串|取 JSON/);
    expect(reviewCommandProblems(good.replace('host.call(&request)', 'request.get("params"); host.call(&request)')).join('\n')).toMatch(/取 JSON|字串/);
    expect(reviewCommandProblems(good.replace('host.call(&request)', 'Ok(request)')).join('\n')).toMatch(/call/);
    expect(reviewCommandProblems('fn other() {}').join('\n')).toMatch(/找不到 fn review/);
  });
});
