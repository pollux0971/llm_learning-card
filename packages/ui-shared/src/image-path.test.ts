/**
 * T46 單元測試 c(07-teach-card phase-4 場景 3、4、5 的資料面):卡片裡圖片路徑的解析,與 `renderMarkdown` 帶選項時的輸出。
 * 測試 agent 寫;開發 worker 不改。工單:docs/tickets/T46-teach-card-examples-images.md「驗收條件 1」的單元測試 c。
 *
 * 工單沒有寫死名字的地方,這份測試釘死下面這些(commit 說明也寫了;worker 照這個做,要改名先回報協調者,由我改測試):
 *   - `packages/ui-shared/src/image-path.ts` 匯出 `resolveImagePath(cardDir: string, rawPath: string)`,
 *     回 `{ ok: true, path: string }`(解析後的 learning 相對路徑)或 `{ ok: false, reason: string }`(reason 非空字串;不測內容)。
 *     也要從 `@learning/ui-shared` 的 index(`index.ts`)匯出。
 *   - `renderMarkdown(source, options?)` 的選項:`{ cardDir: string; assetUrl: (relPath: string) => string }`。
 *     不帶選項 = 行為不變(既有呼叫與測試照舊)。
 *   - 拒絕的圖(解析不過、或 assetUrl 丟錯)輸出「圖片路徑不能用:<卡片原文裡寫的路徑>」的文字,不輸出 <img>、不呼叫(或呼叫了也不用)assetUrl 的回傳值。
 *   - `./.`、空段:拒絕(工單允許「拒絕」或「解析成 assets/a.png」二選一,我選拒絕:§13 的白名單沒有任何正規化)。
 *   - 例子圍欄輸出 `<details class="lc-example" open>` + `<summary>`:一個例子寫「例子」,好幾個寫「例子 1」「例子 2」…(D1=A、D3)。
 *
 * 模組還沒寫:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const IMAGE_PATH = pathToFileURL(join(SRC, 'image-path.ts')).href;
const FENCE = pathToFileURL(join(SRC, 'example-fence.ts')).href;
const INDEX = pathToFileURL(join(SRC, 'index.ts')).href;

type Resolved = { ok: true; path: string } | { ok: false; reason: string };
interface ImagePathModule {
  resolveImagePath(cardDir: string, rawPath: string): Resolved;
}
interface RenderOptions {
  cardDir: string;
  assetUrl: (relPath: string) => string;
  /** 例子一開始是否展開;沒傳 = 展開 */
  examplesOpen?: boolean;
}
interface FenceModule {
  renderMarkdown(source: string, options?: RenderOptions): string;
}

async function loadResolver(): Promise<ImagePathModule['resolveImagePath']> {
  const mod = (await import(/* @vite-ignore */ IMAGE_PATH)) as Partial<ImagePathModule>;
  if (typeof mod.resolveImagePath !== 'function') throw new Error('packages/ui-shared/src/image-path.ts 沒有匯出 resolveImagePath');
  return mod.resolveImagePath;
}
async function loadRender(): Promise<FenceModule['renderMarkdown']> {
  const mod = (await import(/* @vite-ignore */ FENCE)) as FenceModule;
  return mod.renderMarkdown;
}

const CARD_DIR = 'cards/demo';

async function resolve(rawPath: string, cardDir = CARD_DIR): Promise<Resolved> {
  return (await loadResolver())(cardDir, rawPath);
}

/** 假的 assetUrl:記下收到的每一個字串,回一個認得出來的網址 */
function fakeAssetUrl(): { calls: string[]; assetUrl: (relPath: string) => string } {
  const calls: string[] = [];
  return {
    calls,
    assetUrl: (relPath: string) => {
      calls.push(relPath);
      return `fake://asset/${relPath}`;
    },
  };
}

// ───────────────────────────────────────────── resolveImagePath

describe('resolveImagePath:相對於卡片檔所在目錄,解析後第一段必須是最上層 assets', () => {
  const ok: [string, string, string][] = [
    ['../../assets/a.png', 'assets/a.png', '一般的圖'],
    ['../../assets/sub/b.png', 'assets/sub/b.png', 'assets 底下的子目錄'],
    ['../../assets/同源.png', 'assets/同源.png', '中文檔名:不是 %E5…'],
    ['../../assets/é.png', 'assets/é.png', '已經是 NFC 的 é(U+00E9)'],
    ['../../assets/sub/../a.png', 'assets/a.png', '解析之後才看第一段:中間的 .. 先算掉'],
    ['../../assets/a-b_c.v2.png', 'assets/a-b_c.v2.png', '字元集合裡的 - _ .'],
    ['../../assets/com0.png', 'assets/com0.png', '契約 §13:不含 COM0'],
    ['../../assets/lpt0.png', 'assets/lpt0.png', '契約 §13:不含 LPT0'],
    ['../../assets/console.png', 'assets/console.png', 'console 不是 con:只比第一個 . 之前的整段'],
    ['../../assets/com10.png', 'assets/com10.png', 'com10 不是保留名'],
  ];
  for (const [raw, want, why] of ok) {
    it(`${raw} → ${want}(${why})`, async () => {
      expect(await resolve(raw)).toEqual({ ok: true, path: want });
    });
  }

  it('cardDir 是空字串(卡片檔在 learning 根):assets/a.png 就是最上層 assets;.. 會跳出根而拒絕', async () => {
    expect(await resolve('assets/a.png', '')).toEqual({ ok: true, path: 'assets/a.png' });
    expect(await resolve('assets/sub/b.png', '')).toEqual({ ok: true, path: 'assets/sub/b.png' });
    const out = await resolve('../assets/a.png', '');
    expect(out.ok, JSON.stringify(out)).toBe(false);
    const notAssets = await resolve('x/a.png', '');
    expect(notAssets.ok, JSON.stringify(notAssets)).toBe(false);
    const bare = await resolve('assets', '');
    expect(bare.ok, JSON.stringify(bare)).toBe(false);
  });

  it('卡片在別的目錄(cards/security),同一條規則', async () => {
    expect(await resolve('../../assets/a.png', 'cards/security')).toEqual({ ok: true, path: 'assets/a.png' });
    expect(await resolve('../../assets/a.png', 'cards/某個分類')).toEqual({ ok: true, path: 'assets/a.png' });
  });

  const refused: [string, string][] = [
    ['../../raw/demo/x.png', '解析後在 raw'],
    ['../../cards/demo/x.png', '解析後在 cards'],
    ['../../questions/x.png', '解析後在 questions'],
    ['../../assets/../raw/x.png', '先走進 assets、再走出去到 raw:解析後才看,所以拒絕'],
    ['../../assets/../cards/demo/x.png', '先走進 assets、再走出去到 cards'],
    ['../x.png', '解析後 cards/x.png,不在最上層 assets'],
    ['assets/a.png', '在卡片目錄底下的 assets(cards/demo/assets/a.png),不是最上層那個'],
    ['../assets/a.png', '解析後 cards/assets/a.png'],
    ['../../../x.png', '跳出 learning 根'],
    ['../../../../assets/a.png', '跳出 learning 根(再多一層)'],
    ['/assets/a.png', '絕對路徑(開頭的斜線)'],
    ['https://a.test/x.png', '絕對網址 https'],
    ['http://a.test/x.png', '絕對網址 http'],
    ['//a.test/x.png', '協定相對網址'],
    ['lc://localhost/assets/a.png', 'lc 協定'],
    ['data:image/png;base64,AAAA', 'data 網址(D4:拒絕)'],
    ['../../assets/a%20b.png', '含 %:不解碼,% 不在字元集合'],
    ['../../assets/a%2e.png', '含 %(不能被當成點)'],
    ['../../assets/a.png?x', '含 ?'],
    ['../../assets/a.png#y', '含 #'],
    ['..\\..\\assets\\a.png', '反斜線'],
    ['../../assets/a\\b.png', '反斜線在段裡面'],
    ['../../assets/é.png', '不是 NFC 的 é(U+0065 U+0301)'],
    ['../../assets/./a.png', '含 . 段(我選拒絕)'],
    ['../../assets//a.png', '含空段(我選拒絕)'],
    ['../../assets/.hidden.png', '以點開頭的段'],
    ['../../assets/a.', '以點結尾的段'],
    ['../../assets/con.png', 'Windows 保留名 con'],
    ['../../assets/NUL', 'Windows 保留名 NUL(大寫、沒有副檔名)'],
    ['../../assets/com1.png', 'Windows 保留名 com1'],
    ['../../assets/prn.png', 'Windows 保留名 prn'],
    ['../../assets/aux.png', 'Windows 保留名 aux'],
    ['../../assets/AUX.PNG', 'Windows 保留名 AUX(大寫)'],
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((n): [string, string] => [`../../assets/com${n}.png`, `Windows 保留名 com${n}`]),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): [string, string] => [`../../assets/lpt${n}.png`, `Windows 保留名 lpt${n}`]),
    ['../../assets/LPT9', 'Windows 保留名 LPT9(大寫、沒有副檔名)'],
    ['../../assets/com\u00b9.png', 'Windows 保留名 com¹(U+00B9)'],
    ['../../assets/com\u00b2.png', 'Windows 保留名 com²'],
    ['../../assets/com\u00b3.png', 'Windows 保留名 com³'],
    ['../../assets/lpt\u00b9.png', 'Windows 保留名 lpt¹'],
    ['../../assets/lpt\u00b3.txt', 'Windows 保留名 lpt³'],
    ['../../assets/sub/nul.png', '保留名在中間的段(子目錄叫 nul 的檔)'],
    ['../../assets/con/a.png', '保留名是目錄段'],
    ['../../assets/a b.png', '空白不在字元集合'],
    ['../../assets/a:b.png', '冒號不在字元集合'],
    ['../../assets/a*b.png', '星號不在字元集合'],
    ['../../assets/', '沒有檔名(結尾的斜線)'],
    ['../../assets', '只有 assets 本身'],
    ['', '空字串'],
    [`../../assets/${'a'.repeat(236)}.png`, 'UTF-8 位元組數超過 240'],
  ];
  for (const [raw, why] of refused) {
    it(`拒絕 ${JSON.stringify(raw.length > 40 ? `${raw.slice(0, 30)}…(${raw.length} 字)` : raw)}(${why})`, async () => {
      const result = await resolve(raw);
      expect(result.ok, JSON.stringify(result)).toBe(false);
      if (!result.ok) expect(result.reason, '要給原因').toMatch(/\S/);
    });
  }

  it('剛好 240 位元組的路徑過(長度上限是 ≤ 240,不是 < 240)', async () => {
    const name = `${'a'.repeat(240 - 'assets/'.length - '.png'.length)}.png`;
    expect(`assets/${name}`.length).toBe(240);
    expect(await resolve(`../../assets/${name}`)).toEqual({ ok: true, path: `assets/${name}` });
  });

  it('從 @learning/ui-shared 的 index 也匯出', async () => {
    const mod = (await import(/* @vite-ignore */ INDEX)) as Partial<ImagePathModule>;
    expect(typeof mod.resolveImagePath, 'index.ts 要匯出 resolveImagePath').toBe('function');
  });
});

// ───────────────────────────────────────────── renderMarkdown 帶選項

describe('renderMarkdown 帶 { cardDir, assetUrl }:圖片換成 assetUrl 的回傳值', () => {
  const inExample = (img: string): string => `\`\`\`example\n${img}\n\`\`\`\n`;

  it('例子裡的圖:src 是假 assetUrl 的回傳值,假 assetUrl 收到的是解析後的路徑', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(inExample('![圖](../../assets/a.png)'), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('src="fake://asset/assets/a.png"');
    expect(html).toContain('<img');
    expect(fake.calls).toEqual(['assets/a.png']);
  });

  it('內文裡的圖(不在例子裡)也算', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('前面的字\n\n![圖](../../assets/sub/b.png)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('src="fake://asset/assets/sub/b.png"');
    expect(fake.calls).toEqual(['assets/sub/b.png']);
  });

  it('alt 裡再有一張圖:![a ![b](../../assets/x.png)](../../assets/c.png) → assetUrl 只收到外層的 assets/c.png(內層的原文路徑不能蓋掉外層)', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('![a ![b](../../assets/x.png)](../../assets/c.png)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(fake.calls).toEqual(['assets/c.png']);
    const srcs = [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs).toEqual(['fake://asset/assets/c.png']);
    expect(html.split('<img').length - 1, '只有一個 <img>(內層的圖只是 alt 文字)').toBe(1);
  });

  it('alt 裡再有一張圖,外層路徑不能用:只有一段拒絕字樣、assetUrl 一次都沒被叫', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('![a ![b](../../assets/x.png)](https://a.test/c.png)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(fake.calls).toEqual([]);
    expect(html).toContain('圖片路徑不能用:https://a.test/c.png');
    expect(html).not.toContain('<img');
  });

  it('圖片在連結文字裡:[![a](../../assets/x.png)](https://a.test) → 連結還在、裡面的圖照樣換 src(工單 §3:每一張圖都算)', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('[![a](../../assets/x.png)](https://a.test)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('<a href="https://a.test"><img src="fake://asset/assets/x.png" alt="a" data-asset-path="assets/x.png"></a>');
    expect(fake.calls).toEqual(['assets/x.png']);
  });

  it('圖片在連結文字裡、路徑不能用:連結還在、裡面是拒絕字樣、assetUrl 0 次', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('[![a](../../raw/x.png)](https://a.test)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('<a href="https://a.test">圖片路徑不能用:../../raw/x.png</a>');
    expect(html).not.toContain('<img');
    expect(fake.calls).toEqual([]);
  });

  it('跳脫:alt 含 & < > " 各自變 &amp; &lt; &gt; &quot;(& 先換,不會變成 &amp;lt;)', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('![a&b<c>d"e](../../assets/a.png)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('alt="a&amp;b&lt;c&gt;d&quot;e"');
    expect(html).not.toContain('&amp;lt;');
    expect(html).not.toContain('&amp;amp;');
  });

  it('跳脫:assetUrl 回傳的網址含 & < > " 也跳脫過才放進 src(不能從 src 逃出去)', async () => {
    const render = await loadRender();
    const html = render('![a](../../assets/a.png)\n', { cardDir: CARD_DIR, assetUrl: () => 'fake://x?a=1&b="2"<3>' });
    expect(html).toContain('src="fake://x?a=1&amp;b=&quot;2&quot;&lt;3&gt;"');
    expect(html.split('<img').length - 1).toBe(1);
    expect(html).not.toMatch(/<img[^>]*"2"/);
  });

  it('跳脫:拒絕字樣裡的原文路徑含 & 變 &amp;(原文 ../../assets/x&y.png)', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render('![a](../../assets/x&y.png)\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).toContain('圖片路徑不能用:../../assets/x&amp;y.png');
    expect(html).not.toMatch(/x&y\.png/);
    expect(fake.calls).toEqual([]);
  });

  it('原始 HTML 不會變成標籤(html: false):內文與例子裡的 <script>、<img onerror> 都是文字,有帶選項與沒帶選項都一樣', async () => {
    const render = await loadRender();
    const src = '<script>x</script>\n\n<img src=x onerror=window.__pwn=1>\n\n```example\n<script>y</script>\n\n<b onclick=z>粗</b>\n```\n';
    const fake = fakeAssetUrl();
    for (const html of [render(src), render(src, { cardDir: CARD_DIR, assetUrl: fake.assetUrl }), render(src, { cardDir: CARD_DIR, assetUrl: fake.assetUrl, examplesOpen: false })]) {
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<b ');
      expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
      expect(html).toContain('&lt;script&gt;y&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=window.__pwn=1&gt;');
    }
    expect(fake.calls).toEqual([]);
  });

  it('中文檔名:交給 assetUrl 的是 assets/同源.png,不是 markdown-it 編過的 %E5…', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(inExample('![](../../assets/同源.png)'), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(fake.calls).toEqual(['assets/同源.png']);
    expect(html).toContain('src="fake://asset/assets/同源.png"');
    expect(html).not.toContain('%E5');
  });

  it('markdown 的反斜線跳脫 a\\_b.png:原文路徑是跳脫處理過的 assets/a_b.png', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(inExample('![](../../assets/a\\_b.png)'), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(fake.calls).toEqual(['assets/a_b.png']);
    expect(html).toContain('src="fake://asset/assets/a_b.png"');
  });

  it('角括號寫法的路徑 <…>(CommonMark 允許):路徑裡有空白就拒絕', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(inExample('![](<../../assets/a b.png>)'), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(html).not.toContain('<img');
    expect(html).toContain('圖片路徑不能用:');
    expect(fake.calls).toEqual([]);
  });

  it('同一張卡兩張圖:各自經過 assetUrl,順序照原文', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(`![](../../assets/one.png)\n\n${inExample('![](../../assets/two.png)')}`, { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    expect(fake.calls).toEqual(['assets/one.png', 'assets/two.png']);
    expect(html.indexOf('assets/one.png')).toBeLessThan(html.indexOf('assets/two.png'));
  });

  const refusedRaw: string[] = [
    '../../raw/demo/x.png',
    '../../cards/demo/x.png',
    '../x.png',
    'assets/a.png',
    '../../../x.png',
    'https://a.test/x.png',
    '//a.test/x.png',
    'lc://localhost/assets/a.png',
    'data:image/png;base64,AAAA',
    '../../assets/a%20b.png',
    '../../assets/a.png?x',
    '../../assets/a.png#y',
    '../../assets/é.png'.replace('é', 'é'),
    '../../assets/./a.png',
    '../../assets//a.png',
    '../../assets/con.png',
  ];
  for (const raw of refusedRaw) {
    it(`拒絕的路徑 ${JSON.stringify(raw)}:沒有 <img>、assetUrl 0 次、輸出有「圖片路徑不能用:」與原文`, async () => {
      const render = await loadRender();
      const fake = fakeAssetUrl();
      for (const source of [inExample(`![](${raw})`), `![](${raw})\n`]) {
        fake.calls.length = 0;
        const html = render(source, { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
        expect(html, '不能有 <img>').not.toContain('<img');
        expect(fake.calls, 'assetUrl 不能被呼叫').toEqual([]);
        expect(html).toContain('圖片路徑不能用:');
        // 原文路徑當文字放進去(跳脫過;這些路徑沒有要跳脫的字元,除了 & 不在裡面)
        expect(html).toContain(raw);
      }
    });
  }

  it('assetUrl 丟錯(桌面殼的 PathRefusedError)也當不過:佔位字樣、沒有 <img>', async () => {
    const render = await loadRender();
    const html = render(inExample('![](../../assets/a.png)'), {
      cardDir: CARD_DIR,
      assetUrl: () => {
        throw new Error('path refused (reserved): "assets/a.png"');
      },
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('圖片路徑不能用:');
    expect(html).toContain('../../assets/a.png');
  });

  for (const raw of ['file:///x.png', 'javascript:x', 'data:text/plain,x', 'vbscript:x']) {
    it(`markdown-it 的 validateLink 擋掉 ${raw}:不是圖片 token,沒有 <img>、assetUrl 0 次(不要求佔位字樣)`, async () => {
      const render = await loadRender();
      const fake = fakeAssetUrl();
      const html = render(inExample(`![](${raw})`), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
      expect(html).not.toContain('<img');
      expect(fake.calls).toEqual([]);
    });
  }

  it('路徑含 "><img src=x onerror=…>、<b>、&:字樣裡看得到原字,輸出沒有多出元素或屬性(跳脫)', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const evil = '../../assets/a"><img/src=x/onerror=window.pwn=1><b>x</b>&amp;<i>.png';
    for (const source of [inExample(`![](${evil})`), `![](${evil})\n`]) {
      const html = render(source, { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
      expect(html, '沒有 <img').not.toContain('<img');
      expect(html, '角括號與引號要跳脫').toContain('&lt;img/src=x/onerror=window.pwn=1&gt;');
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(html).toContain('&lt;i&gt;');
      expect(html).toContain('&quot;');
      const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!.toLowerCase());
      for (const forbidden of ['img', 'b', 'i', 'script']) expect(tags, `輸出不能有 <${forbidden}>`).not.toContain(forbidden);
      expect(/<[^>]*\sonerror\s*=/i.test(html), '沒有 onerror 屬性').toBe(false);
    }
    expect(fake.calls).toEqual([]);
  });

  it('alt 文字裡的角括號也不變成元素', async () => {
    const render = await loadRender();
    const fake = fakeAssetUrl();
    const html = render(inExample('![<b>粗</b>"x](../../raw/x.png)'), { cardDir: CARD_DIR, assetUrl: fake.assetUrl });
    const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!.toLowerCase());
    expect(tags).not.toContain('b');
    expect(tags).not.toContain('img');
  });
});

describe('renderMarkdown 不帶選項:行為不變', () => {
  it('沒有例子圍欄的文件:輸出跟單純的 markdown-it(html:false、linkify:true)逐字相同,圖片路徑原樣', async () => {
    const render = await loadRender();
    const plain = new MarkdownIt({ html: false, linkify: true });
    const docs = [
      '一般段落,**粗體**與 https://example.com 。\n',
      '![圖](../../assets/a.png)\n',
      '- 項目\n- ![](assets/b.png)\n\n```ts\nconst a = 1;\n```\n',
    ];
    for (const doc of docs) expect(render(doc)).toBe(plain.render(doc));
  });

  it('例子裡的圖不帶選項:src 照 markdown-it 原本的(沒有 assetUrl 可以呼叫)', async () => {
    const render = await loadRender();
    const html = render('```example\n![x](../../assets/a.png)\n```\n');
    expect(html).toContain('src="../../assets/a.png"');
    expect(html).not.toContain('圖片路徑不能用');
  });
});

// ───────────────────────────────────────────── 例子圍欄:折疊的標題(D1=A、D3)

describe('例子圍欄輸出 <details>/<summary>,標題 例子 / 例子 N', () => {
  const summaries = (html: string): string[] => [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, '').trim());

  it('一個例子:一個 <details class="lc-example" open>,標題「例子」,內容在 <details> 裡面', async () => {
    const render = await loadRender();
    const html = render('```example\n- 內容一\n- 內容二\n```\n');
    expect(html).toMatch(/<details[^>]*class="lc-example"[^>]*>/);
    expect(html, '預設展開').toMatch(/<details[^>]*\bopen\b[^>]*>/);
    expect(summaries(html)).toEqual(['例子']);
    const detailsAt = html.indexOf('<details');
    const summaryEnd = html.indexOf('</summary>');
    const liAt = html.indexOf('<li>內容一</li>');
    const detailsEnd = html.indexOf('</details>');
    expect(summaryEnd, '標題在內容前面').toBeGreaterThan(detailsAt);
    expect(liAt, '內容在標題後面').toBeGreaterThan(summaryEnd);
    expect(detailsEnd, '內容在 <details> 裡面').toBeGreaterThan(liAt);
  });

  describe('examplesOpen(例子一開始展開與否,由卡片換掉時讀到的折疊狀態決定)', () => {
    const body = '```example\n- 內容一\n```\n\n```example\n- 內容二\n```\n';
    const opts = (examplesOpen?: boolean): RenderOptions => ({ cardDir: CARD_DIR, assetUrl: fakeAssetUrl().assetUrl, ...(examplesOpen === undefined ? {} : { examplesOpen }) });
    const tags = (html: string): string[] => [...html.matchAll(/<details\b[^>]*>/g)].map((m) => m[0]);

    it('examplesOpen: false → 每個 <details> 都沒有 open,但標題與內容都還在', async () => {
      const render = await loadRender();
      const html = render(body, opts(false));
      expect(tags(html)).toHaveLength(2);
      for (const tag of tags(html)) {
        expect(tag, '要有 lc-example').toContain('class="lc-example"');
        expect(tag, '收合:不能有 open').not.toMatch(/\bopen\b/);
      }
      expect(summaries(html)).toEqual(['例子 1', '例子 2']);
      expect(html).toContain('<li>內容一</li>');
      expect(html).toContain('<li>內容二</li>');
    });

    it('收合時整個開頭是 <details class="lc-example"><summary>(沒有 open、也沒有多餘屬性);展開時是 <details class="lc-example" open><summary>', async () => {
      const render = await loadRender();
      const one = '```example\n- 內容一\n```\n';
      expect(render(one, opts(false))).toContain('<details class="lc-example"><summary>例子</summary>');
      expect(render(one, opts(true))).toContain('<details class="lc-example" open><summary>例子</summary>');
      expect(render(one)).toContain('<details class="lc-example" open><summary>例子</summary>');
      const two = render(body, opts(false));
      expect(two).toContain('<details class="lc-example"><summary>例子 1</summary>');
      expect(two).toContain('<details class="lc-example"><summary>例子 2</summary>');
      expect(two.split('</details>').length - 1).toBe(2);
    });

    it('examplesOpen: true → 每個 <details> 都有 open', async () => {
      const render = await loadRender();
      const html = render(body, opts(true));
      expect(tags(html)).toHaveLength(2);
      for (const tag of tags(html)) expect(tag).toMatch(/\bopen\b/);
      expect(summaries(html)).toEqual(['例子 1', '例子 2']);
    });

    it('有 options 但沒帶 examplesOpen → 有 open(預設展開)', async () => {
      const render = await loadRender();
      for (const tag of tags(render(body, opts()))) expect(tag).toMatch(/\bopen\b/);
    });

    it('完全不帶 options → 有 open', async () => {
      const render = await loadRender();
      for (const tag of tags(render(body))) expect(tag).toMatch(/\bopen\b/);
    });

    it('收合時也在例子裡的圖照樣換 src、照樣檢查路徑(open 只影響屬性,不影響內容)', async () => {
      const render = await loadRender();
      const fake = fakeAssetUrl();
      const html = render('```example\n![圖](../../assets/a.png)\n\n![壞](../../raw/x.png)\n```\n', { cardDir: CARD_DIR, assetUrl: fake.assetUrl, examplesOpen: false });
      expect(html).not.toMatch(/<details[^>]*\bopen\b/);
      expect(html).toContain('src="fake://asset/assets/a.png"');
      expect(html).toContain('圖片路徑不能用:../../raw/x.png');
      expect(fake.calls).toEqual(['assets/a.png']);
    });

    it('收合渲染之後再渲染一次不帶 examplesOpen:不殘留上一次的狀態', async () => {
      const render = await loadRender();
      expect(tags(render(body, opts(false)))[0]).not.toMatch(/\bopen\b/);
      expect(tags(render(body, opts()))[0]).toMatch(/\bopen\b/);
      expect(tags(render(body))[0]).toMatch(/\bopen\b/);
    });
  });

  it('圍欄資訊:```example 標題(多字)、```  example(前面有空白)、```example<tab>x 仍算例子;```Example、```examples、```example-x 不算', async () => {
    const render = await loadRender();
    const yes = render(['```example 這是標題', 'a', '```', '', '```  example', 'b', '```', '', '```example\tx y', 'c', '```', ''].join('\n'));
    expect(summaries(yes)).toEqual(['例子 1', '例子 2', '例子 3']);
    expect(yes).toContain('<p>a</p>');
    expect(yes).toContain('<p>b</p>');
    expect(yes).toContain('<p>c</p>');
    for (const info of ['Example', 'examples', 'example-x', 'xexample', 'sample']) {
      const html = render(`\`\`\`${info}\nz\n\`\`\`\n`);
      expect(html, `\`\`\`${info} 不是例子`).not.toContain('<details');
      expect(html).toContain('<pre><code');
    }
  });

  it('三個例子:例子 1、例子 2、例子 3,依序,各自一個 <details>', async () => {
    const render = await loadRender();
    const html = render(['```example', 'a', '```', '', '正文', '', '```example', 'b', '```', '', '```example', 'c', '```', ''].join('\n'));
    expect(summaries(html)).toEqual(['例子 1', '例子 2', '例子 3']);
    expect(html.split('<details').length - 1).toBe(3);
  });

  it('兩個例子:例子 1、例子 2;其他語言的圍欄不算數(```ts 夾在中間)', async () => {
    const render = await loadRender();
    const html = render(['```example', 'a', '```', '', '```ts', 'const a = 1;', '```', '', '```example', 'b', '```', ''].join('\n'));
    expect(summaries(html)).toEqual(['例子 1', '例子 2']);
  });

  it('編號每次渲染重新算:同一個文件渲染兩次,標題一樣(沒有跨次累加)', async () => {
    const render = await loadRender();
    const one = '```example\na\n```\n';
    expect(summaries(render(one))).toEqual(['例子']);
    expect(summaries(render(one))).toEqual(['例子']);
    const two = '```example\na\n```\n\n```example\nb\n```\n';
    expect(summaries(render(two))).toEqual(['例子 1', '例子 2']);
    expect(summaries(render(one))).toEqual(['例子']);
  });

  it('巢狀 markdown 照常:清單、粗體、內層程式碼區塊都在 <details> 裡面', async () => {
    const render = await loadRender();
    const html = render('````example\n- **粗**\n\n```ts\nconst a = 1;\n```\n````\n');
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('<pre><code');
    expect(html.indexOf('<pre>')).toBeGreaterThan(html.indexOf('</summary>'));
    expect(html.indexOf('<pre>')).toBeLessThan(html.indexOf('</details>'));
  });
});
