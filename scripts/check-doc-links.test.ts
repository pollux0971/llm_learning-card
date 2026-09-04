/**
 * scripts/check-doc-links.ts 的測試(P-28 commit 2)。
 *
 * 這支也是掃描器,所以一樣不能讓它測自己:如果直接掃這個 repo,
 * 「0 條連結要 FAIL」那條分支永遠跑不到(repo 裡有二十條連結),
 * 而且以後任何人改文件都會讓測試莫名其妙變紅。所以全部用臨時目錄當 root,
 * 餵已知的 markdown 進去,只斷言退出碼與輸出。
 *
 * 直接呼叫 main(argv) 而不是開子行程:它已經回傳 { code, output },
 * 跟 packages/core/src/prompt-quality/cli.test.ts 同一個做法,快很多。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main, SCANNER_BROKEN } from './check-doc-links.js';

const tmpDirs: string[] = [];

function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-doclinks-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

function run(files: Record<string, string>): { code: number; output: string } {
  return main(['--root', fixtureRoot(files)]);
}

/** 從 `doc-links: 掃描 N 個 markdown 檔,M 條相對連結` 取出 M。 */
function linkCount(output: string): number {
  const m = /(\d+) 條相對連結/.exec(output);
  expect(m, `輸出裡沒有「M 條相對連結」:\n${output}`).not.toBeNull();
  return Number(m![1]);
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('壞連結', () => {
  it('指到不存在的檔案 → 退出碼 1,而且指名道姓說是哪一個檔案的哪一行', () => {
    const { code, output } = run({
      'docs/a.md': '看 [設計](./00-design.md)\n',
      'docs/b.md': '#\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('docs/a.md');
    expect(output).toContain('./00-design.md');
    // 這不是「掃描器壞了」,是文件真的有一條斷掉的連結。兩種紅不能混。
    expect(output).not.toContain(SCANNER_BROKEN);
  });

  it('好壞混在一起時,只報壞的那一條', () => {
    const { code, output } = run({
      'docs/a.md': '好的 [b](./b.md),壞的 [c](./c.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('./c.md');
    expect(output).not.toContain('./b.md');
  });

  it('往上跳出目錄的相對連結也驗', () => {
    const { code, output } = run({
      'docs/a.md': '[根](../README.md) 與 [沒有](../NOPE.md)\n',
      'README.md': '# repo\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('../NOPE.md');
    expect(output).not.toContain('../README.md');
  });
});

describe('好連結不誤報', () => {
  it('檔案都在 → 退出碼 0,並印出掃到的檔數與連結數', () => {
    const { code, output } = run({
      'docs/a.md': '看 [b](./b.md) 跟 [契約](../contracts/types.md)\n',
      'docs/b.md': '# b\n',
      'contracts/types.md': '# types\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(2);
    expect(output).toMatch(/掃描 \d+ 個 markdown 檔/);
  });

  it('圖片語法 ![]() 跟一般連結一樣驗', () => {
    const bad = run({
      'docs/a.md': '![圖](./missing.png)\n[真的連結](./a.md)\n',
    });
    expect(bad.code).toBe(1);
    expect(bad.output).toContain('./missing.png');

    const good = run({
      'docs/a.md': '![圖](./pic.png)\n',
      'docs/pic.png': 'x',
    });
    expect(good.code).toBe(0);
  });

  it('連結帶 title 的形式 [文字](路徑 "說明") 也認得', () => {
    const { code, output } = run({
      'docs/a.md': '[b](./b.md "說明文字")\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });
});

describe('反引號裡的檔名是行文提及,不是連結', () => {
  it('inline code 裡的 [x](./missing.md) 不算連結', () => {
    const { code, output } = run({
      'docs/a.md': '寫成 `[x](./missing.md)` 只是舉例。\n真的連結:[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('fenced code block 裡的連結不算', () => {
    const { code, output } = run({
      'docs/a.md': [
        '```markdown',
        '[示範](./this-does-not-exist.md)',
        '```',
        '',
        '[b](./b.md)',
        '',
      ].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('~~~ 圍欄跟 ``` 一樣算 code', () => {
    const { code } = run({
      'docs/a.md': ['~~~', '[示範](./nope.md)', '~~~', '', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
  });

  it('圍欄裡又出現一行帶 info string 的圍欄時,不可以提早收掉區塊', () => {
    // 這是 docs/00-design.md:114-121 的真實形狀。一段 ```markdown 裡面示範了一張卡,
    // 卡的內容自己又有一行 ```example。用非貪婪的 /```[\s\S]*?```/ 去挖 code,
    // 會在 ```example 那裡就以為區塊收掉了,於是後面那行示範用的圖片連結被當成真連結,
    // 掃描器報一條根本不存在的壞連結。CommonMark 的規則是:有 info string 的圍欄
    // 不能當收尾,只有純 ``` 才收尾。
    const { code, output } = run({
      'docs/a.md': [
        '```markdown',
        '# 卡片示範',
        '',
        '```example',
        'https://a.com/page 與 https://a.com/api → 同源',
        '',
        '![同源判定流程](../../assets/sec-0042-sop.png)',
        '```',
        '```',
        '',
        '真的連結:[b](./b.md)',
        '',
      ].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(output).not.toContain('sec-0042-sop.png');
    expect(linkCount(output)).toBe(1);
  });
});

describe('外部連結略過', () => {
  it('http:// 與 https:// 不驗,也不算進連結數', () => {
    const { code, output } = run({
      'docs/a.md': [
        '[外部](https://example.com/nope.md)',
        '[外部](http://example.com/also-nope.md)',
        '[內部](./b.md)',
        '',
      ].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('只有外部連結時,相對連結數是 0,所以照樣 FAIL', () => {
    const { code, output } = run({
      'docs/a.md': '[外部](https://example.com/)\n',
    });

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  });
});

describe('錨點只驗檔案部分', () => {
  it('檔案存在、錨點隨便寫 → 過(不驗錨點本身)', () => {
    const { code, output } = run({
      'docs/a.md': '[b 的某一節](./b.md#完全不存在的一節)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('檔案不存在、帶錨點 → 抓得到,而且報的是原文', () => {
    const { code, output } = run({
      'docs/a.md': '[沒有](./missing.md#section)\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('./missing.md');
  });

  it('純 #錨點 是同檔跳轉,不算相對連結', () => {
    const { code, output } = run({
      'docs/a.md': '[同一篇](#某一節)\n[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });
});

describe('掃到 0 條連結 → 一律 FAIL', () => {
  it('markdown 有掃到但一條連結都沒有:退出碼 1,不是 0', () => {
    const { code } = run({
      'docs/a.md': '# 純文字\n沒有任何連結。\n',
      'features/01-x/FEATURE.md': '# 也沒有\n',
    });

    expect(code).toBe(1);
  });

  it('訊息要明講「掃描器壞了」', () => {
    const { code, output } = run({ 'docs/a.md': '# 純文字\n' });

    expect(code).toBe(1);
    expect(output).toContain('掃描到 0 條相對連結');
    expect(output).toContain(SCANNER_BROKEN);
  });

  it('連 markdown 檔都掃不到時,一樣是 0 條 → FAIL', () => {
    const { code, output } = run({ 'docs/notes.txt': '不是 markdown\n' });

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  });
});

describe('掃描範圍', () => {
  it('docs/ features/ contracts/ 與根目錄 README 都掃', () => {
    const { code, output } = run({
      'docs/a.md': '[x](./nope-docs.md)\n',
      'features/01-x/FEATURE.md': '[x](./nope-features.md)\n',
      'contracts/types.md': '[x](./nope-contracts.md)\n',
      'README.md': '[x](./nope-readme.md)\n',
    });

    expect(code).toBe(1);
    for (const t of ['./nope-docs.md', './nope-features.md', './nope-contracts.md', './nope-readme.md']) {
      expect(output, `漏掃了 ${t}`).toContain(t);
    }
  });

  it('掃描範圍外的 markdown 不看(例如 packages/ 底下的 README)', () => {
    const { code, output } = run({
      'packages/core/README.md': '[x](./nope-packages.md)\n',
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(output).not.toContain('nope-packages.md');
  });

  it('node_modules 裡的 markdown 不掃', () => {
    const { code } = run({
      'docs/node_modules/junk/README.md': '[x](./nope.md)\n',
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
  });
});
