/**
 * T22 驗收 4(行程這一層):起**真的** `scripts/review-sidecar.ts`,用 stdin / stdout 一行一則 JSON 跟它講話。
 * 紅測試作者寫;開發 worker 不改。程序內的方法邏輯在 `review-handler.test.ts`;訊息形狀的向量在
 * `packages/core/src/session/protocol.test.ts`;Rust 那邊在 `apps/desktop/src-tauri/tests/review_sidecar.rs`。
 *
 * 量尺在 `features/support/review-sidecar-harness.ts`(起行程、讀行、關 stdin)。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp,不碰真的 learning/ 與真的 ~/.cache);
 * 子行程的網路層是假的(`LC_REVIEW_FAKE_CLOUD` 指向 `_fake-review-cloud.mjs`),不打網路、不花錢;簽出裡沒有 `.env`。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  TODAY,
  addDays,
  cachePath,
  createVault,
  gitInit,
  headMessage,
  readReviews,
  removeVault,
  reviewRecord,
  reviewsPath,
  writeReviews,
  type Vault,
} from '../features/support/review-session-harness.js';
import { FAKE_CLOUD_MODULE, request, spawnSidecar, type Sidecar } from '../features/support/review-sidecar-harness.js';

const TIMEOUT = 120_000;
const vaults: Vault[] = [];
const procs: Sidecar[] = [];
afterAll(() => {
  for (const p of procs) p.kill();
  for (const v of vaults) removeVault(v);
});

function vault(over: { cards?: number; vaultId?: string | null } = {}): Vault {
  const v = createVault({ cards: over.cards ?? 6, ...(over.vaultId === undefined ? {} : { vaultId: over.vaultId }) });
  vaults.push(v);
  writeReviews(v, {
    'sec-0001': reviewRecord({ stage: 1, next_due: addDays(TODAY, -3) }),
    'sec-0002': reviewRecord({ stage: 1, next_due: addDays(TODAY, -2) }),
    'sec-0003': reviewRecord({ stage: 3, next_due: addDays(TODAY, -1) }),
  });
  return v;
}
function start(v: Vault, opts: Parameters<typeof spawnSidecar>[1] = {}): Sidecar {
  const p = spawnSidecar(v, opts);
  procs.push(p);
  return p;
}
const ok = (r: Record<string, unknown>): Record<string, unknown> => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.result as Record<string, unknown>;
};
const kindOf = (r: Record<string, unknown>): string => {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  return (r.error as { kind: string }).kind;
};
const fillAnswers = (v: Vault, card: string): string[] =>
  (parseYaml(readFileSync(join(v.dir, 'questions', `${card}.yaml`), 'utf8')) as { fill: { answers: string[][] }[] }).fill[0]!.answers.map((g) => g[0]!);
/** 整個程序從頭到尾 stdout 出現的每一行都要是協定行(JSON 物件、v 是 1) */
function expectOnlyProtocolLines(p: Sidecar): void {
  expect(p.stdoutTail(), 'stdout 沒有沒收尾的半行').toBe('');
  expect(p.stdoutLines.length).toBeGreaterThan(0);
  for (const line of p.stdoutLines) {
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(line);
    }, `stdout 出現協定以外的一行:${line.slice(0, 80)}`).not.toThrow();
    expect((parsed as { v?: unknown }).v, line.slice(0, 80)).toBe(1);
  }
}

describe('啟動與 hello(驗收 4)', () => {
  it(
    '第一行是 hello:v 1、kind hello、fakeCloud true、today;stderr 有「正在用假 router」',
    async () => {
      const v = vault();
      const p = start(v);
      const hello = JSON.parse((await p.nextLine(60_000)) ?? 'null') as Record<string, unknown>;
      expect(hello).toEqual({ v: 1, kind: 'hello', fakeCloud: true, today: TODAY });
      expect(p.stderr()).toContain('[review-sidecar] 正在用假 router');
    },
    TIMEOUT,
  );

  it(
    '沒設 LC_REVIEW_FAKE_CLOUD:fakeCloud false,而且 stderr 沒有「正在用假 router」(不會悄悄說自己是假的,也不會悄悄用假的)',
    async () => {
      const v = vault();
      const p = start(v, { fakeCloud: null });
      const hello = JSON.parse((await p.nextLine(60_000)) ?? 'null') as Record<string, unknown>;
      expect(hello).toEqual({ v: 1, kind: 'hello', fakeCloud: false, today: TODAY });
      expect(p.stderr()).not.toContain('正在用假 router');
    },
    TIMEOUT,
  );

  it(
    '沒設 LC_REVIEW_TODAY:今天是本機日期(YYYY-MM-DD)',
    async () => {
      const v = vault();
      const p = start(v, { today: null });
      const hello = JSON.parse((await p.nextLine(60_000)) ?? 'null') as { today: string };
      expect(hello.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
    TIMEOUT,
  );

  it(
    'LC_REVIEW_TODAY 格式不對:印 [review-sidecar] bad-today、退出碼 2、stdout 沒有任何一行(沒有 hello)',
    async () => {
      const v = vault();
      for (const bad of ['2026-9-1', 'today', '2026-13-40x', '']) {
        const p = start(v, { today: bad });
        expect(await p.exited(60_000), `LC_REVIEW_TODAY=${JSON.stringify(bad)}`).toBe(2);
        expect(p.stderr()).toContain('[review-sidecar] bad-today');
        expect(p.stdoutLines).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'stdin 結束(EOF):行程自己結束,退出碼 0(app 被強制結束時不留孤兒)',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      p.endStdin();
      expect(await p.exited(20_000)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    '請求處理到一半 stdin 結束:也結束(不卡住)',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      ok(await request(p, 1, 'start'));
      p.endStdin();
      expect(await p.exited(20_000)).toBe(0);
    },
    TIMEOUT,
  );
});

describe('一行一則,依序處理(驗收 3、4)', () => {
  it(
    '一次寫進三則請求,依序回三行,id 對得上',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      p.writeRaw(`${JSON.stringify({ v: 1, id: 1, method: 'status', params: {} })}\n${JSON.stringify({ v: 1, id: 2, method: 'start', params: {} })}\n${JSON.stringify({ v: 1, id: 3, method: 'status', params: {} })}\n`);
      const ids: unknown[] = [];
      for (let i = 0; i < 3; i += 1) ids.push((JSON.parse((await p.nextLine(60_000)) ?? 'null') as { id: unknown }).id);
      expect(ids).toEqual([1, 2, 3]);
    },
    TIMEOUT,
  );

  it(
    '壞的一行都回錯誤而不結束:壞 JSON、CRLF、超長、v 2、大小寫不同的 method、U+2028;每一行壞的恰好一行回應,後面的正常請求照常處理',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      expect(kindOf(await p.call('not json'))).toBe('bad-request');
      expect(kindOf(await p.call(`${JSON.stringify({ v: 1, id: 2, method: 'status', params: {} })}\r`))).toBe('bad-request');
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 3, method: 'submit', params: { apply: 'a'.repeat(300_000) } })))).toBe('too-large');
      expect(kindOf(await p.call(JSON.stringify({ v: 2, id: 4, method: 'status', params: {} })))).toBe('unsupported-version');
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 5, method: 'Status', params: {} })))).toBe('unknown-method');
      const lineSep = String.fromCodePoint(0x2028);
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 6, method: `sta${lineSep}tus`, params: {} })))).toBe('unknown-method');
      const paraSep = String.fromCodePoint(0x2029);
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 7, method: `sta${paraSep}tus`, params: {} })))).toBe('unknown-method');
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 8, method: 'status', params: { path: 'cards/x.md' } })))).toBe('bad-request');
      expect(kindOf(await p.call(JSON.stringify({ v: 1, id: 9, method: 'start', params: { card: 'sec-0001' } })))).toBe('bad-request');
      expect(p.isAlive()).toBe(true);
      expect(ok(await request(p, 10, 'status'))).toEqual({ paused: false, today: TODAY });
      expect(p.stdoutLines.length, 'hello + 9 則壞的 + 1 則好的 = 11 行,不多不少').toBe(11);
    },
    TIMEOUT,
  );

  it(
    '壞的一行的錯誤:id 讀得出就帶,讀不出是 null;message 是固定句子',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      const bad = await p.call('not json');
      expect(bad).toMatchObject({ v: 1, id: null, ok: false, error: { kind: 'bad-request' } });
      const unknown = await p.call(JSON.stringify({ v: 1, id: 77, method: 'pause', params: {} }));
      expect(unknown).toMatchObject({ id: 77, ok: false, error: { kind: 'unknown-method' } });
      expect(typeof (unknown.error as { message: string }).message).toBe('string');
    },
    TIMEOUT,
  );
});

describe('完整一輪(真的行程 + 假雲端)(驗收 4)', () => {
  it(
    'start → next → submit(填空、應用)→ summary:結果形狀對、reviews.json 逐題落地、假雲端只在應用題被叫',
    async () => {
      const v = vault();
      const log = join(v.scratch, 'cloud-requests.log');
      const p = start(v, { env: { FAKE_REVIEW_REQUEST_LOG: log } });
      await p.nextLine(60_000);
      expect(ok(await request(p, 1, 'start'))).toEqual({ state: 'ready', today: TODAY, resumed: false, total: 3, answered: 0, deferred: 0, dailyCap: 10, overdue: 3, fakeCloud: true });
      let id = 2;
      for (const expectedCard of ['sec-0001', 'sec-0002', 'sec-0003']) {
        const q = ok(await request(p, id++, 'next'));
        expect(q).toMatchObject({ kind: 'question', card: expectedCard });
        const out = q.type === 'fill' ? ok(await request(p, id++, 'submit', { fill: fillAnswers(v, expectedCard) })) : ok(await request(p, id++, 'submit', { apply: 'PASSALL 這是回答' }));
        expect(out).toMatchObject({ status: 'passed', pass: true, cardDone: true });
        expect(readReviews(v)[expectedCard]!.history.some((h) => h.date === TODAY)).toBe(true);
      }
      expect(ok(await request(p, id++, 'next'))).toEqual({ kind: 'done' });
      const summary = ok(await request(p, id++, 'summary'));
      expect(summary).toMatchObject({ passed: 3, returned: 0, retryLater: 0 });
      expect(['skipped', 'committed', 'no-changes', 'failed']).toContain(summary.snapshot);
      const cloudCalls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.trim() !== '').length : 0;
      expect(cloudCalls, '只有應用題叫雲端(填空答對走精確比對)').toBe(1);
      expectOnlyProtocolLines(p);
    },
    TIMEOUT,
  );

  it(
    '批改失敗不是錯誤:應用題收到亂回 → ok true、status error、cardDone false;reviews.json 逐位元不變;next 還是同一題',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      ok(await request(p, 1, 'start'));
      // 先把前兩題(填空)答掉,輪到 sec-0003 的應用題
      for (const [i, card] of ['sec-0001', 'sec-0002'].entries()) {
        ok(await request(p, 2 + i * 2, 'next'));
        ok(await request(p, 3 + i * 2, 'submit', { fill: fillAnswers(v, card) }));
      }
      const q = ok(await request(p, 10, 'next'));
      expect(q).toMatchObject({ card: 'sec-0003', type: 'apply' });
      const before = readFileSync(reviewsPath(v), 'utf8');
      expect(ok(await request(p, 11, 'submit', { apply: 'GARBAGE 亂回' }))).toMatchObject({ status: 'error', pass: null, cardDone: false });
      expect(readFileSync(reviewsPath(v), 'utf8')).toBe(before);
      expect(ok(await request(p, 12, 'next'))).toMatchObject({ kind: 'question', card: 'sec-0003', type: 'apply' });
    },
    TIMEOUT,
  );

  it(
    '結束時 snapshot:learning/ 是 git repo,答了題之後 summary 回 committed,而且真的多了一個 commit;result 沒有 hint',
    async () => {
      const v = vault();
      gitInit(v);
      const p = start(v);
      await p.nextLine(60_000);
      ok(await request(p, 1, 'start'));
      ok(await request(p, 2, 'next'));
      ok(await request(p, 3, 'submit', { fill: fillAnswers(v, 'sec-0001') }));
      const summary = ok(await request(p, 4, 'summary'));
      expect(summary.snapshot).toBe('committed');
      expect('hint' in summary).toBe(false);
      expect(headMessage(v).length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

describe('紀錄被改過(T26)(驗收 4)', () => {
  it(
    'next 拿到題目之後 reviews.json 被別處改了,submit 回 review-record-changed:逐位元不動、行程還活著、之後 next 回 no-session',
    async () => {
      const v = vault();
      const p = start(v);
      await p.nextLine(60_000);
      ok(await request(p, 1, 'start'));
      const q = ok(await request(p, 2, 'next'));
      const reviews = readReviews(v);
      reviews['sec-0002'] = { ...reviews['sec-0002']!, history: [{ date: TODAY, stage: 1, type: 'fill', pass: true, grader: 'exact' }] };
      writeReviews(v, reviews);
      const changed = readFileSync(reviewsPath(v), 'utf8');

      const res = await request(p, 3, 'submit', { fill: fillAnswers(v, q.card as string) });
      expect(kindOf(res)).toBe('review-record-changed');
      expect((res.error as { message: string }).message).toBe('複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。');
      expect(readFileSync(reviewsPath(v), 'utf8')).toBe(changed);
      expect(p.isAlive()).toBe(true);
      expect(kindOf(await request(p, 4, 'next'))).toBe('no-session');
      expect(kindOf(await request(p, 5, 'submit', { fill: ['a', 'b', 'c'] }))).toBe('no-session');

      // 重新 start:被拒絕的那一題再問一次
      ok(await request(p, 6, 'start'));
      expect(ok(await request(p, 7, 'next'))).toMatchObject({ kind: 'question', card: q.card });
    },
    TIMEOUT,
  );
});

describe('指標檔與帳本身分(驗收 4)', () => {
  it(
    '指標檔指向的目錄跟 --dir 不同:start 回 root-mismatch(固定句子),不開始、不建快取',
    async () => {
      const a = vault();
      const b = vault();
      // a 的使用者層指標檔改成指向 b
      const pointer = join(a.xdgConfig, 'llm-learning-cards', 'vault.json');
      writeFileSync(pointer, JSON.stringify({ learning_dir: b.dir, vault_id: b.vaultId }), 'utf8');
      const p = start(a);
      await p.nextLine(60_000);
      const res = await request(p, 1, 'start');
      expect(kindOf(res)).toBe('root-mismatch');
      expect(existsSync(cachePath(a, TODAY))).toBe(false);
      expect(p.isAlive()).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '沒有帳本身分(沒有指標檔):start 回 router-unavailable;之後 status 還能用',
    async () => {
      const v = vault({ vaultId: null });
      const p = start(v);
      await p.nextLine(60_000);
      expect(kindOf(await request(p, 1, 'start'))).toBe('router-unavailable');
      expect(ok(await request(p, 2, 'status'))).toEqual({ paused: false, today: TODAY });
    },
    TIMEOUT,
  );
});

describe('stdout 只有協定行(驗收 4)', () => {
  /** 載入時與每次叫雲端時都 console.log / info / debug / warn 的假雲端——側車必須把這些導到 stderr */
  function noisyFakeCloud(v: Vault): string {
    const path = join(v.scratch, 'noisy-fake-cloud.mjs');
    const real = pathToFileURL(FAKE_CLOUD_MODULE).href;
    writeFileSync(
      path,
      [
        "console.log('NOISE-LOG-AT-LOAD');",
        "console.info('NOISE-INFO-AT-LOAD');",
        "console.debug('NOISE-DEBUG-AT-LOAD');",
        "console.warn('NOISE-WARN-AT-LOAD');",
        `await import(${JSON.stringify(real)});`,
        'const realFetch = globalThis.fetch;',
        'globalThis.fetch = async (...args) => {',
        "  console.log('NOISE-LOG-IN-FETCH');",
        "  console.warn('NOISE-WARN-IN-FETCH');",
        '  return realFetch(...args);',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    return path;
  }

  it(
    '依賴印的 console.log / info / debug / warn 只到 stderr:stdout 每一行都是協定行(hello 在第一行),stderr 看得到雜訊',
    async () => {
      const v = vault();
      const p = start(v, { fakeCloud: noisyFakeCloud(v) });
      const hello = JSON.parse((await p.nextLine(60_000)) ?? 'null') as Record<string, unknown>;
      expect(hello).toMatchObject({ v: 1, kind: 'hello', fakeCloud: true });
      ok(await request(p, 1, 'start'));
      // 前兩題填空,第三題應用題會經過 fetch(有雜訊)
      for (const [i, card] of ['sec-0001', 'sec-0002'].entries()) {
        ok(await request(p, 2 + i * 2, 'next'));
        ok(await request(p, 3 + i * 2, 'submit', { fill: fillAnswers(v, card) }));
      }
      ok(await request(p, 10, 'next'));
      ok(await request(p, 11, 'submit', { apply: 'PASSALL 好' }));
      expectOnlyProtocolLines(p);
      const err = p.stderr();
      for (const noise of ['NOISE-LOG-AT-LOAD', 'NOISE-INFO-AT-LOAD', 'NOISE-DEBUG-AT-LOAD', 'NOISE-WARN-AT-LOAD', 'NOISE-LOG-IN-FETCH', 'NOISE-WARN-IN-FETCH']) {
        expect(err, `${noise} 要出現在 stderr`).toContain(noise);
        expect(p.stdoutLines.join('\n'), `${noise} 不能出現在 stdout`).not.toContain(noise);
      }
    },
    TIMEOUT,
  );
});

describe('金鑰不出側車、錯誤不帶原文(驗收 4)', () => {
  const SECRET = 'sk-lc-secret-ABCDEFGH12345678';

  it(
    '環境裡有金鑰樣子的值:完整一輪(含壞的一行、internal 錯誤、批改失敗)之後,stdout 與 stderr 都找不到它(整個值與前 8 個字元)',
    async () => {
      const v = vault();
      const p = start(v, { env: { OPENAI_API_KEY: SECRET, ANTHROPIC_API_KEY: SECRET } });
      await p.nextLine(60_000);
      await p.call('not json');
      ok(await request(p, 1, 'start'));
      ok(await request(p, 2, 'next'));
      ok(await request(p, 3, 'submit', { fill: fillAnswers(v, 'sec-0001') }));
      ok(await request(p, 4, 'next'));
      ok(await request(p, 5, 'submit', { fill: fillAnswers(v, 'sec-0002') }));
      ok(await request(p, 6, 'next'));
      ok(await request(p, 7, 'submit', { apply: 'GARBAGE' }));
      ok(await request(p, 8, 'summary'));
      const everything = `${p.stdoutLines.join('\n')}\n${p.stderr()}`;
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain(SECRET.slice(0, 8));
    },
    TIMEOUT,
  );

  it(
    'internal:reviews.json 壞掉時 start 回 internal 與固定句子;stderr 只印 [review-sidecar] internal,沒有例外原文、stack、路徑',
    async () => {
      const v = vault();
      mkdirSync(join(v.dir, 'state'), { recursive: true });
      writeFileSync(reviewsPath(v), '{ 這不是 JSON', 'utf8');
      const p = start(v, { env: { OPENAI_API_KEY: SECRET } });
      await p.nextLine(60_000);
      const res = await request(p, 1, 'start');
      expect(kindOf(res)).toBe('internal');
      const text = JSON.stringify(res);
      for (const leak of ['SyntaxError', 'Unexpected', v.dir, 'reviews.json', 'node_modules', SECRET]) expect(text, leak).not.toContain(leak);
      expect(p.stderr()).toContain('[review-sidecar] internal');
      for (const leak of ['SyntaxError', 'Unexpected token', v.dir, 'node_modules', SECRET]) expect(p.stderr(), leak).not.toContain(leak);
      expect(p.isAlive()).toBe(true);
      expect(ok(await request(p, 2, 'status'))).toEqual({ paused: false, today: TODAY });
    },
    TIMEOUT,
  );

  it(
    '不寫 learning/ 以外的檔、也不在 learning/ 底下多出任何不屬於複習的檔:跑完一輪後 learning/ 的新檔只有 reviews.json、log、(git 時)git 內部',
    async () => {
      const v = vault();
      const before = new Set(listRel(v.dir));
      const p = start(v);
      await p.nextLine(60_000);
      ok(await request(p, 1, 'start'));
      ok(await request(p, 2, 'next'));
      ok(await request(p, 3, 'submit', { fill: fillAnswers(v, 'sec-0001') }));
      const added = listRel(v.dir).filter((f) => !before.has(f));
      expect(added.filter((f) => !f.startsWith('state/')), '只准動 state/ 底下').toEqual([]);
      // 快取在 XDG cache,不在 learning/ 底下(ADR-074)
      expect(existsSync(cachePath(v, TODAY))).toBe(true);
    },
    TIMEOUT,
  );
});

function listRel(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full.slice(root.length + 1));
    }
  };
  walk(root);
  return out;
}
