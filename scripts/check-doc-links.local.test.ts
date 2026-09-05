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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findRelativeLinks, main, SCANNER_BROKEN, stripCode } from './check-doc-links.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/** CLI 進入點那兩個測試會開 `npx tsx` 子行程,機器忙的時候超過 vitest 預設的 5 秒。 */
const SPAWN_TIMEOUT_MS = 60_000;

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
  const m = /(-?\d+) 條相對連結/.exec(output);
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

// ─────────────────────────────────────────────────────────────────────────────
// 以下是審核輪(P-29)補的。上一輪 stryker 跑出來 63.13%,存活的變異指出
// commit message 講了但沒有任何測試釘住的行為:行號保留、inline code 的精確
// 長度配對、角括號 / protocol-relative / mailto: 的略過、README* 的命名、
// 百分號還原、不帶 --root 的既有行為、以及 CLI 進入點本身。
// ─────────────────────────────────────────────────────────────────────────────

describe('stripCode 挖掉 code 之後,行號與欄位不能跑掉', () => {
  it('挖掉的東西換成等長空白:行數與每一行的長度都不變', () => {
    const src = [
      '# 標題',
      '```markdown',
      '[示範](./nope.md)',
      '```',
      '一段 `inline code` 的文字',
      '',
    ].join('\n');

    const out = stripCode(src);

    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    for (const [i, line] of out.split('\n').entries()) {
      expect(line.length, `第 ${i + 1} 行長度變了`).toBe(src.split('\n')[i]!.length);
    }
  });

  it('圍欄整段變空白,圍欄外的字原樣留著', () => {
    const lines = ['前面', '```', '[示範](./nope.md)', '```', '後面 [b](./b.md)'];
    const blank = (s: string) => ' '.repeat(s.length);

    expect(stripCode(lines.join('\n'))).toBe(
      [lines[0]!, blank(lines[1]!), blank(lines[2]!), blank(lines[3]!), lines[4]!].join('\n'),
    );
  });

  it('inline code 換成等長空白,同一行後面的真連結位置不變', () => {
    expect(stripCode('說 `[x](./a.md)` 再說 [b](./b.md)')).toBe(
      '說               再說 [b](./b.md)',
    );
  });

  it('報出來的行號是原檔的行號,不是挖掉之後的', () => {
    const { code, output } = run({
      'docs/a.md': [
        '# 標題', // 1
        '', // 2
        '```markdown', // 3
        '[示範](./ignored.md)', // 4
        '```', // 5
        '', // 6
        '[壞的](./missing.md)', // 7
        '',
      ].join('\n'),
    });

    expect(code).toBe(1);
    expect(output).toContain('docs/a.md:7');
  });
});

describe('inline code 的收尾必須是剛好一樣長的反引號串', () => {
  it('單反引號包住 ``` 時,不可以把中間那串當收尾(00-design.md:126 的形狀)', () => {
    const { code, output } = run({
      'docs/a.md': '- **範例放在 ` ```example ` 圍欄內**,見 [設計](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('沒有配對收尾的反引號不吃掉後面的連結', () => {
    const { code, output } = run({
      'docs/a.md': '一個孤兒反引號 ` 然後 [b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('雙反引號要用雙反引號收,中間的單反引號不算', () => {
    expect(stripCode('``a ` b`` 之後 [c](./c.md)')).toBe(`${' '.repeat(9)} 之後 [c](./c.md)`);
  });
});

describe('圍欄的其餘四條規則', () => {
  it('規則 5:比外層短的圍欄收不了尾(```` 外層,裡面的 ``` 只是內文)', () => {
    const { code, output } = run({
      'docs/a.md': [
        '````',
        '```',
        '[示範](./nope.md)',
        '```',
        '````',
        '',
        '[b](./b.md)',
        '',
      ].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('規則 2:``` 圍欄裡的 ~~~ 是內文,收不了尾', () => {
    const { code, output } = run({
      'docs/a.md': ['```', '~~~', '[示範](./nope.md)', '~~~', '```', '', '[b](./b.md)', ''].join(
        '\n',
      ),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('規則 3:比外層長的純圍欄可以收尾', () => {
    const { code, output } = run({
      'docs/a.md': ['```', '[示範](./nope.md)', '````', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('``` 的 info string 裡有反引號 → 那一行不是圍欄(CommonMark)', () => {
    // ```a`b 不是合法的圍欄開頭,所以下一行的連結是真的內文,不能被挖掉。
    const { code, output } = run({
      'docs/a.md': ['```a`b', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('縮排 3 格以內的圍欄算圍欄', () => {
    const { code, output } = run({
      'docs/a.md': ['   ```', '   [示範](./nope.md)', '   ```', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });
});

describe('連結的各種寫法', () => {
  it("單引號 title 形式 [文字](路徑 '說明') 也認得", () => {
    const { code, output } = run({
      'docs/a.md': "[b](./b.md '說明')\n",
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('括號 title 形式 [文字](路徑 (說明)) 也認得', () => {
    const { code, output } = run({
      'docs/a.md': '[b](./b.md (說明))\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('路徑前後有空白也認得', () => {
    const { code, output } = run({
      'docs/a.md': '[b](  ./b.md  )\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('角括號形式 [文字](<路徑>) 要脫掉角括號再驗', () => {
    const good = run({
      'docs/a.md': '[b](<./b.md>)\n',
      'docs/b.md': '# b\n',
    });
    expect(good.code).toBe(0);
    expect(linkCount(good.output)).toBe(1);

    const bad = run({ 'docs/a.md': '[沒有](<./missing.md>)\n' });
    expect(bad.code).toBe(1);
    // 報出來的是脫掉角括號之後的路徑,不是原文帶角括號的樣子
    expect(bad.output).toContain('./missing.md');
    expect(bad.output).not.toContain('<./missing.md>');
  });

  it('空的角括號 [x](<>) 沒有目標,不算一條連結', () => {
    const { code, output } = run({
      'docs/a.md': '[空的](<>)\n[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('壞掉的百分號編碼不丟例外,原樣拿去找檔案', () => {
    // decodeURIComponent('./a%ZZ.md') 會丟 URIError,catch 之後要退回原字串。
    const { code, output } = run({
      'docs/a.md': '[怪的](./a%ZZ.md)\n',
      'docs/a%ZZ.md': '# 怪的\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('百分號編碼要還原:./a%20b.md 對到檔名有空白的 a b.md', () => {
    const { code, output } = run({
      'docs/a.md': '[有空白的檔名](./a%20b.md)\n',
      'docs/a b.md': '# a b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });
});

describe('哪些目標不算相對連結', () => {
  it('mailto: 與 file: 一樣是外部,略過', () => {
    const { code, output } = run({
      'docs/a.md': ['[寄信](mailto:a@b.c)', '[本機檔](file:///tmp/x.md)', '[b](./b.md)', ''].join(
        '\n',
      ),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('protocol-relative //host/x.md 是外部,略過', () => {
    const { code, output } = run({
      'docs/a.md': '[外部](//example.com/nope.md)\n[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
    expect(output).not.toContain('example.com');
  });

  it('scheme 要從頭比對:路徑中間有冒號的相對連結還是相對連結', () => {
    const { code, output } = run({
      'docs/a.md': '[怪檔名](./a:b.md)\n',
      'docs/a:b.md': '# a:b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });
});

describe('掃描範圍的邊界', () => {
  // 模板 v1.2.0 把根目錄的掃描範圍從 main 的「只有 README*.md」放寬成「所有根目錄 *.md」
  // (不遞迴)。這是變寬不是變窄——CLAUDE.md、MEMORY.md 這類根目錄文件現在也受檢查。
  it('根目錄的 *.md 都掃,README-zh.md 與 NOTES.md 都算', () => {
    const { code, output } = run({
      'README-zh.md': '[x](./nope-readme-zh.md)\n',
      'NOTES.md': '[x](./nope-notes.md)\n',
    });

    expect(code).toBe(1);
    expect(output).toContain('./nope-readme-zh.md');
    expect(output).toContain('./nope-notes.md');
  });

  it('根目錄的 readme 目錄(不是檔案)不算', () => {
    const { code, output } = run({
      'readme.md/inside.txt': 'x\n',
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    // docs/a.md 與 docs/b.md 兩個;根目錄那個 readme.md 是目錄,不算檔案
    expect(output).toMatch(/掃描 2 個 markdown 檔/);
  });

  it('掃描目錄底下的非 .md 檔不看', () => {
    const { code, output } = run({
      'docs/notes.txt': '[x](./nope-txt.md)\n',
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(output).not.toContain('./nope-txt.md');
    expect(linkCount(output)).toBe(1);
  });

  // 模板 v1.2.0/v1.2.1 一度掉了這四個排除(建置產物與 git 內部檔被當成專案文件檢查),
  // 這條測試把它擋了下來;v1.2.2 起放回內建預設,並開放 gates.config.json 的
  // docLinks.skipSegments 再追加。
  it('dist/ 與 .git/ 底下的 markdown 不掃', () => {
    const { code, output } = run({
      'docs/dist/x.md': '[x](./nope-dist.md)\n',
      'docs/.git/y.md': '[x](./nope-git.md)\n',
      'docs/target/z.md': '[x](./nope-target.md)\n',
      'docs/.svelte-kit/w.md': '[x](./nope-svelte.md)\n',
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
    for (const t of ['nope-dist', 'nope-git', 'nope-target', 'nope-svelte']) {
      expect(output, `不該掃到 ${t}`).not.toContain(t);
    }
  });
});

describe('連結數要真的是數出來的', () => {
  it('三條好連結就要印 3,不是別的數字', () => {
    const { code, output } = run({
      'docs/a.md': '[b](./b.md) [c](./c.md)\n[d](./d.md)\n',
      'docs/b.md': '# b\n',
      'docs/c.md': '# c\n',
      'docs/d.md': '# d\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(3);
  });

  it('findRelativeLinks 回報的行號跟原文對得上', () => {
    const links = findRelativeLinks(['第一行', '[b](./b.md)', '', '[c](./c.md)'].join('\n'));

    expect(links).toEqual([
      { target: './b.md', line: 2 },
      { target: './c.md', line: 4 },
    ]);
  });
});

describe('不帶 --root 時的既有行為', () => {
  it('沒有 --root 就掃這個 repo:連結數 > 0、退出碼 0', () => {
    const { code, output } = main([]);

    expect(code).toBe(0);
    expect(linkCount(output)).toBeGreaterThan(0);
    expect(output).toContain('✓ 無壞掉的連結');
  });

  it('--verbose 之類不認得的參數不會被當成 root', () => {
    const { code, output } = main(['--verbose']);

    expect(code).toBe(0);
    expect(linkCount(output)).toBeGreaterThan(0);
  });
});

describe('CLI 進入點', () => {
  it('直接跑 scripts/check-doc-links.ts 會印出結果並回傳退出碼', () => {
    const root = fixtureRoot({ 'docs/a.md': '[沒有](./missing.md)\n' });

    const r = spawnSync('npx', ['tsx', 'scripts/check-doc-links.ts', '--root', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain('./missing.md');
  }, SPAWN_TIMEOUT_MS);

  it('直接跑、掃到 0 條連結時退出碼 1 並說掃描器壞了', () => {
    const root = fixtureRoot({ 'docs/a.md': '# 沒有連結\n' });

    const r = spawnSync('npx', ['tsx', 'scripts/check-doc-links.ts', '--root', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain(SCANNER_BROKEN);
  }, SPAWN_TIMEOUT_MS);
});

// ── 第二批(P-29):上一批之後還存活的變異裡,屬於「commit message 講了但沒釘住」的部分 ──

describe('圍欄的判定只看行首', () => {
  it('行中間出現的 ``` 不是圍欄,同一行的連結照樣算', () => {
    // /^ {0,3}(`{3,}|~{3,})/ 的 ^ 若拿掉,這一行會被當成圍欄開頭,
    // 之後整份文件都被當成 code,連結全部消失。
    const { code, output } = run({
      'docs/a.md': '參數寫成 ``` 三個反引號 ```,見 [b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('行中間的 ``` 後面沒有別的反引號時,也不算圍欄', () => {
    // 上一條那個例子有第二串反引號,會被「``` 的 info string 不能有反引號」擋掉,
    // 所以另外釘一條:純粹靠行首的 ^ 才擋得住的形狀。
    const { code, output } = run({
      'docs/a.md': '見 ``` 之後 [b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('收尾圍欄後面有空白仍然是收尾(info string 要 trim)', () => {
    const { code, output } = run({
      'docs/a.md': ['```', '[示範](./nope.md)', '```   ', '', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('~~~ 的 info string 可以有反引號(只有 ``` 不行)', () => {
    const { code, output } = run({
      'docs/a.md': ['~~~a`b', '[示範](./nope.md)', '~~~', '', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('規則 5 的短圍欄是內文,不是新的一層(不然外層會收不掉)', () => {
    // ```` 外層,裡面一行 ``` 沒有收尾,再一行 ```` 收外層。
    // 如果那行 ``` 被當成 push,外層的 ```` 只會收掉它,stack 沒清空,
    // 後面真的連結就被整段吃掉。
    const { code, output } = run({
      'docs/a.md': ['````', '```', '[示範](./nope.md)', '````', '', '[b](./b.md)', ''].join('\n'),
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(linkCount(output)).toBe(1);
  });

  it('沒有配對收尾的反引號原樣留著,不會把後面變成 NaN', () => {
    expect(stripCode('孤兒 ` 反引號')).toBe('孤兒 ` 反引號');
  });
});

describe('--root 指到不存在的目錄', () => {
  it('不丟例外,而是 0 條連結 → FAIL', () => {
    const { code, output } = main(['--root', join(tmpdir(), 'lc-doclinks-absolutely-no-such-dir')]);

    expect(code).toBe(1);
    expect(output).toContain(SCANNER_BROKEN);
  });
});

describe('根目錄只撿 readme*.md', () => {
  it('readme.txt 不是 markdown,不掃', () => {
    const { code, output } = run({
      'readme.txt': '[x](./nope-readme-txt.md)\n',
      'README.md': '[b](./b.md)\n',
      'b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(output).not.toContain('nope-readme-txt');
    expect(linkCount(output)).toBe(1);
  });
});

describe('輸出的完整格式(訊息本身就是這張工單的產出)', () => {
  // 模板 v1.3.0 起,第一行多印一行「生效中的排除清單」(內建預設 + gates.config.json 追加)。
  // 那行是刻意的:排除清單現在可設定,看不到它就沒辦法判斷「掃到的檔數為什麼是這個數字」。
  // 模板 v1.4.0 起(S10)預設清單改成所有掃描器共用的 `_root.ts` DEFAULT_SKIP_DIRS,順序與內容跟著它。
  const SKIP_LINE =
    'doc-links: 排除片段 [node_modules, .git, .next, .nuxt, .svelte-kit, dist, build, out, coverage, ' +
    '.turbo, .cache, target, __pycache__, .venv, venv, reports, .stryker-tmp, archive]、' +
    '排除前綴 [.claude/worktrees, contracts/fixtures]';

  it('全綠:排除清單、統計、✓,沒有多餘的東西', () => {
    const { code, output } = run({
      'docs/a.md': '[b](./b.md)\n',
      'docs/b.md': '# b\n',
    });

    expect(code).toBe(0);
    expect(output).toBe(
      `${SKIP_LINE}\ndoc-links: 掃描 2 個 markdown 檔,1 條相對連結\n✓ 無壞掉的連結\n` +
        'gate=doc-links result=PASS scanned=1',
    );
  });

  it('有壞連結:排除清單、統計、空行、✗ 標題、每條一行、最後是怎麼修', () => {
    const { code, output } = run({ 'docs/a.md': '[沒有](./missing.md)\n' });

    expect(code).toBe(1);
    expect(output.split('\n')).toEqual([
      SKIP_LINE,
      'doc-links: 掃描 1 個 markdown 檔,1 條相對連結',
      '',
      '✗ 1 條連結指到不存在的檔案:',
      '  docs/a.md:1  →  ./missing.md',
      '',
      '改了檔名或搬了目錄就要一起改指過去的連結;真的要指到還沒有的檔案就先別寫成連結。',
      // 模板 v1.3.2 起,每支守門最後多印一行機器可讀的 gate 標記(CHANGELOG 1.3.2 (C))。
      'gate=doc-links result=FAIL scanned=1',
    ]);
  });

  it('0 條連結:排除清單、統計一行、掃描器壞了一行', () => {
    const { code, output } = run({ 'docs/a.md': '# 沒有連結\n' });

    expect(code).toBe(1);
    expect(output.split('\n')).toEqual([
      SKIP_LINE,
      'doc-links: 掃描 1 個 markdown 檔,掃描到 0 條相對連結',
      `${SCANNER_BROKEN}。掃描範圍 SCAN_DIRS、副檔名、或 stripCode 挖太多時就長這樣。`,
      'gate=doc-links result=FAIL scanned=0',
    ]);
  });
});
