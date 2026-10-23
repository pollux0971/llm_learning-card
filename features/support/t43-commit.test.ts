/**
 * T43(07 phase-3):字數規則、寫入的順序與內容、圖、撞號(工單第 2、3 節;場景 Generated cards obey the same word limit)。
 * 測試 agent 寫;開發 worker 不改。世界、假 router 見 `t43-harness.ts`。看磁碟,不看畫面。
 *
 * 重點:
 *   - 字數:超過 100 字要重寫,最多重試到共 3 次嘗試(初稿 + 2 次重寫);3 次都超過的那一張略過,其他照留;重寫的呼叫也是 task deepen;
 *   - 先寫考題檔、再寫卡檔(中途停掉時,留下沒有卡的考題檔無害;留下沒有考題檔的卡,學過之後隔天考試卡就壞);
 *   - 卡檔內容跟 ingest 的 `children.ts` 寫出來的**一字不差**(同一個格式),考題檔跟 `writeQuestionFile` 同格式;
 *   - 圖:這個分類的圖讀不到(沒有檔、沒有這個分類、檔壞了)→ 不建新圖、不動檔、記 warning、卡照留;
 *   - 撞號(寫入前發現目標卡檔或考題檔已存在)→ 整批不寫、deepen-failed。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import {
  EXACT_BODY,
  LONG_BODY,
  PARENT,
  SHORT_BODY,
  TODAY,
  VALID_QUESTIONS,
  candidates,
  cardFiles,
  cleanupRigs,
  deepRig,
  diskHashes,
  errorKind,
  logEvents,
  newIds,
  questionFiles,
  readCardText,
  resultOf,
  type Candidate,
} from './t43-harness.js';

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

afterAll(cleanupRigs);

const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];
const created = (v: Parameters<typeof cardFiles>[0]): string[] => cardFiles(v).filter((id) => !BASE.includes(id));

describe('Scenario: Generated cards obey the same word limit', () => {
  const two = (second: string): Candidate[] => [
    { title: '新卡1', body: SHORT_BODY, examples: [] },
    { title: '新卡2', body: second, examples: [] },
  ];

  it('一張三次都超過 100 字:只寫一張;超字那張的重寫呼叫剛好 2 次(初稿 + 2 次重寫 = 3 次嘗試);另一張照留', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => two(LONG_BODY);
        router.regenerate = () => [{ title: '', body: LONG_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const regen = r.router.of('regenerate');
    expect(regen, '超字那張重寫剛好 2 次,不是 0、1、3').toHaveLength(2);
    expect(regen.every((c) => c.task === 'deepen'), '重寫也是 task deepen').toBe(true);
    expect(regen.every((c) => c.title === '新卡2')).toBe(true);
    expect(created(r.v)).toHaveLength(1);
    expect(String((await import('../../packages/core/src/schema/parse-card.js')).parseCardText(readCardText(r.v, created(r.v)[0]!)).frontmatter['title'])).toBe('新卡1');
    expect(questionFiles(r.v).filter((id) => !BASE.includes(id)), '被略過的那張沒有考題檔').toEqual(created(r.v));
    expect(r.router.of('questions'), '只替留下的那一張出考題').toHaveLength(1);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ skipped: 1, children: created(r.v) });
  });

  it('略過的張數記一筆 warning:只寫父卡 id 與張數,不寫卡片內容(標題、正文)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => two(LONG_BODY);
        router.regenerate = () => [{ title: '', body: LONG_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const warnings = logEvents(r.v, 'warning');
    expect(warnings).toHaveLength(1);
    const text = JSON.stringify(warnings[0]);
    expect(text).toContain(PARENT);
    expect(text).toMatch(/1/);
    expect(text, '不能帶卡片內容').not.toContain('新卡2');
    expect(text).not.toContain('worda');
    expect(text).not.toContain(SHORT_BODY);
  });

  it('第一次重寫就合格:只重寫 1 次;檔案裡是重寫後的 body,不是初稿', async () => {
    const fixed = '這是重寫之後合格的短內文。';
    const r = await deepRig({
      setup: (router) => {
        router.children = () => two(LONG_BODY);
        router.regenerate = () => [{ title: '', body: fixed, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(true);
    expect(r.router.of('regenerate')).toHaveLength(1);
    expect(created(r.v)).toHaveLength(2);
    const texts = created(r.v).map((id) => readCardText(r.v, id));
    expect(texts.some((t) => t.includes(fixed))).toBe(true);
    expect(texts.every((t) => !t.includes('worda')), '超字的初稿不能留在磁碟上').toBe(true);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ skipped: 0 });
    expect(logEvents(r.v, 'warning')).toEqual([]);
  });

  it('第二次重寫才合格:重寫 2 次,仍然留下(第 3 次嘗試過關)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => two(LONG_BODY);
        router.regenerate = (_t, attempt) => [{ title: '', body: attempt >= 2 ? '第二次重寫才合格的內文。' : LONG_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(r.router.of('regenerate')).toHaveLength(2);
    expect(created(r.v)).toHaveLength(2);
  });

  it('邊界:剛好 100 字不重寫;101 字重寫', async () => {
    const exact = await deepRig({ setup: (router) => { router.children = () => [{ title: '新卡1', body: EXACT_BODY, examples: [] }]; } });
    await exact.view('teach.open');
    await exact.send('teach.deepen');
    expect((await exact.pollDone())['ok']).toBe(true);
    expect(exact.router.of('regenerate'), '100 字合格').toHaveLength(0);
    expect(created(exact.v)).toHaveLength(1);

    const over = await deepRig({
      setup: (router) => {
        router.children = () => [{ title: '新卡1', body: LONG_BODY, examples: [] }, ...candidates(2).slice(1)];
        router.regenerate = () => [{ title: '', body: SHORT_BODY, examples: [] }];
      },
    });
    await over.view('teach.open');
    await over.send('teach.deepen');
    await over.pollDone();
    expect(over.router.of('regenerate'), '101 字要重寫').toHaveLength(1);
  });

  it('字數用同一條路算:body 的連字號切斷序列(same-origin 算 2),所以 51 個 same-origin 是 102 字 → 要重寫', async () => {
    const hyphen = Array.from({ length: 51 }, () => 'same-origin').join(' ');
    const r = await deepRig({
      setup: (router) => {
        router.children = () => [{ title: '新卡1', body: hyphen, examples: [] }];
        router.regenerate = () => [{ title: '', body: SHORT_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(r.router.of('regenerate'), '契約 §2:連字號與句點會切斷序列').toHaveLength(1);
  });

  it('每張都三次超字:沒有能用的卡 → deepen-failed;不寫任何檔、不記 deepened、不出考題', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(2, LONG_BODY);
        router.regenerate = () => [{ title: '', body: LONG_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('deepen-failed');
    expect(diskHashes(r.v)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect(r.router.of('questions')).toHaveLength(0);
    expect(r.router.of('regenerate')).toHaveLength(4);
  });

  it('一張考題生不出來(回應不是 JSON)、一張考題沒過驗證器:各略過那一張,第三張照留;不是整批不寫', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(3);
        router.questions = (_c, title) =>
          title === '新卡1' ? '這不是 JSON' : title === '新卡2' ? JSON.stringify({ fill: [VALID_QUESTIONS.fill[0]], apply: VALID_QUESTIONS.apply }) : JSON.stringify(VALID_QUESTIONS);
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(created(r.v)).toHaveLength(1);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ skipped: 2 });
    const text = JSON.stringify(logEvents(r.v, 'warning')[0]);
    expect(text).toContain(PARENT);
    expect(text).not.toContain('新卡');
  });

  it('考題截斷或逾時:同 ingest 重打一次(截斷加倍 maxTokens),第二次成功就留下', async () => {
    const { OutputTruncatedError } = await import('../../packages/core/src/llm/index.js');
    let tries = 0;
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(1);
        router.questions = () => {
          tries += 1;
          return tries === 1 ? new OutputTruncatedError('deepen', 4096) : JSON.stringify(VALID_QUESTIONS);
        };
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const q = r.router.of('questions');
    expect(q).toHaveLength(2);
    expect(q[0]!.opts?.['maxTokens']).toBe(4096);
    expect(q[1]!.opts?.['maxTokens'], '截斷重打時加倍').toBe(8192);
    expect(created(r.v)).toHaveLength(1);
  });
});

describe('卡檔與考題檔的內容(一字不差)', () => {
  it('卡檔跟 children.ts 的 writeCardFile 同一個格式:front matter(yaml)、空行、body、範例區塊', async () => {
    const cands: Candidate[] = [
      { title: '新卡1', body: '  第一張的內文,前後有空白。  ', examples: ['範例一', '  範例二  '] },
      { title: '新卡2', body: SHORT_BODY, examples: [] },
    ];
    const r = await deepRig({ setup: (router) => { router.children = () => cands; } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const expectFile = (id: string, c: Candidate): string => {
      const fm = {
        id,
        category: 'security',
        title: c.title,
        level: 2,
        source: 'llm',
        created: TODAY,
        parent: PARENT,
        prereqs: [PARENT],
        provisional: false,
        stale: false,
        source_missing: false,
      };
      const blocks = c.examples.map((e) => '```example\n' + e.trim() + '\n```').join('\n\n');
      return `---\n${yamlStringify(fm).trimEnd()}\n---\n\n${c.body.trim()}\n${blocks ? '\n' + blocks + '\n' : ''}`;
    };
    expect(readCardText(r.v, 'sec-0004')).toBe(expectFile('sec-0004', cands[0]!));
    expect(readCardText(r.v, 'sec-0005')).toBe(expectFile('sec-0005', cands[1]!));
  });

  it('考題檔跟 writeQuestionFile 同格式:yaml.stringify({ card, fill, apply })', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(1); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const text = readFileSync(join(r.v.dir, 'questions/sec-0004.yaml'), 'utf8');
    expect(text).toBe(yamlStringify({ card: 'sec-0004', fill: VALID_QUESTIONS.fill, apply: VALID_QUESTIONS.apply }));
  });

  it('寫完沒有留下暫存檔(.tmp)', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(3); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    expect((await r.pollDone())['ok']).toBe(true);
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(3)]);
    for (const sub of ['cards/security', 'questions', 'graph']) {
      const { readdirSync } = await import('node:fs');
      for (const name of readdirSync(join(r.v.dir, sub))) expect(name, `${sub}/${name}`).not.toMatch(/tmp|\.swp|~$/);
    }
  });
});

describe('先寫考題檔、再寫卡檔(考題檔寫失敗時,磁碟上沒有任何新卡檔)', () => {
  it('questions/ 不能寫:poll 回錯誤;cards/ 裡沒有新卡檔;圖沒動;沒有 deepened', async () => {
    if (process.getuid?.() === 0) return; // root 不受檔案權限約束
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    const hashes = diskHashes(r.v);
    chmodSync(join(r.v.dir, 'questions'), 0o555);
    try {
      await r.send('teach.deepen');
      const done = await r.pollDone();
      expect(done['ok'], '寫入失敗要回錯誤').toBe(false);
      expect(['deepen-failed', 'internal']).toContain(errorKind(done));
    } finally {
      chmodSync(join(r.v.dir, 'questions'), 0o755);
    }
    expect(cardFiles(r.v), '考題檔寫不進去時,卡檔不能已經在磁碟上').toEqual(BASE);
    expect(diskHashes(r.v)).toEqual(hashes);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect((await r.view('teach.next')).card?.id, '之後教學卡照常').toBe('sec-0003');
  });
});

describe('圖(D6):讀不到這個分類的圖 → 不建新圖、不動檔、記 warning、卡照留', () => {
  for (const mode of ['no-file', 'no-category', 'broken'] as const) {
    it(`graph = ${mode}:卡與考題照寫,deps.json ${mode === 'no-file' ? '沒有被建出來' : '位元組不變'},有一筆 warning,畫面是第一張新卡`, async () => {
      const r = await deepRig({ graph: mode, setup: (router) => { router.children = () => candidates(2); } });
      await r.view('teach.open');
      const depsPath = join(r.v.dir, 'graph/deps.json');
      const depsBefore = existsSync(depsPath) ? readFileSync(depsPath, 'utf8') : undefined;
      await r.send('teach.deepen');
      const done = await r.pollDone();
      expect(done['ok'], JSON.stringify(done)).toBe(true);
      expect(resultOf(done).card?.id).toBe('sec-0004');
      expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
      expect(questionFiles(r.v)).toEqual(expect.arrayContaining(newIds(2)));
      if (depsBefore === undefined) expect(existsSync(depsPath), '不硬建一張只有這幾張卡的圖').toBe(false);
      else expect(readFileSync(depsPath, 'utf8')).toBe(depsBefore);
      const warnings = logEvents(r.v, 'warning');
      expect(warnings).toHaveLength(1);
      expect(JSON.stringify(warnings[0])).toMatch(/ingest/);
      expect(logEvents(r.v, 'deepened')).toHaveLength(1);
    });
  }
});

describe('撞號:寫入前發現目標卡檔或考題檔已存在 → 整批不寫、deepen-failed', () => {
  it('終端機的 ingest 在生成中間先用掉了 sec-0004:卡檔撞號,整批不寫,別人的檔一個位元組不動', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'questions');
    await r.send('teach.deepen');
    await gate.reached; // 子卡已回來,id 已配發
    const stray = join(r.v.dir, 'cards/security/sec-0004.md');
    writeFileSync(stray, '別人剛 ingest 出來的卡\n', 'utf8');
    const before = diskHashes(r.v);
    gate.release();
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('deepen-failed');
    expect(readFileSync(stray, 'utf8')).toBe('別人剛 ingest 出來的卡\n');
    expect(diskHashes(r.v), '整批不寫:考題檔、另一張卡、圖都沒動').toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
  });

  it('只有考題檔撞號(別人先放了 questions/sec-0005.yaml):一樣整批不寫', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'questions');
    await r.send('teach.deepen');
    await gate.reached;
    mkdirSync(join(r.v.dir, 'questions'), { recursive: true });
    writeFileSync(join(r.v.dir, 'questions/sec-0005.yaml'), 'card: sec-0005\n', 'utf8');
    const before = diskHashes(r.v);
    gate.release();
    const done = await r.pollDone();
    expect(errorKind(done)).toBe('deepen-failed');
    expect(diskHashes(r.v)).toEqual(before);
    expect(cardFiles(r.v)).toEqual(BASE);
  });
});
