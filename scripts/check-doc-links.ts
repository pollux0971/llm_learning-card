/**
 * markdown 相對連結檢查(P-28)。
 *
 * 掃 `docs/`、`features/`、`contracts/` 與根目錄的 README,
 * 檢查 markdown 裡的**相對連結**指到的檔案是不是真的存在。
 *
 * 規則:
 *   - 反引號裡提到的檔名不算連結(那是行文提及,不是連結)。fenced code block
 *     (``` 與 ~~~)與 inline code(`x`)裡的東西一律不算
 *   - 外部連結(http:// https:// mailto:)略過
 *   - 錨點只驗檔案部分:`./a.md#section` 驗 `./a.md`;純 `#section` 是同檔錨點,略過
 *   - **掃到 0 條連結也要 FAIL**:0 條跟「全部都對」的退出碼一樣是 0,
 *     那是掃描器壞了,不是文件很乾淨(同 check-boundaries / check-standalone)
 *
 * 用法:
 *   npx tsx scripts/check-doc-links.ts               # 檢查整個 repo
 *   npx tsx scripts/check-doc-links.ts --root <dir>  # 改掃別的根目錄(測試用)
 *
 * 退出碼:0 全部連結都存在;1 有壞連結,或一條連結都沒掃到。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** 要掃的目錄。根目錄的 README*.md 另外處理。 */
export const SCAN_DIRS = ['docs', 'features', 'contracts'];

/** 三支掃描器共用的那句話。0 個東西的紅,方向永遠是「掃描器壞了」。 */
export const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/** 走目錄時不進去的地方。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '.svelte-kit']);

export interface BrokenLink {
  /** repo 相對路徑 */
  file: string;
  line: number;
  /** 原文寫的目標,含錨點 */
  target: string;
}

export interface DocLinkResult {
  /** 掃到的 markdown 檔數 */
  files: number;
  /** 掃到的相對連結條數(外部連結與純錨點不算) */
  links: number;
  broken: BrokenLink[];
}

/** 一層還沒收尾的圍欄。len 記長度是因為收尾的圍欄不可以比開頭短。 */
interface OpenFence {
  char: '`' | '~';
  len: number;
}

/** 把整行換成等長的空白:內容沒了,行號與欄位還在。 */
function blankLine(line: string): string {
  return ' '.repeat(line.length);
}

/**
 * 這一行是不是圍欄?回傳圍欄字元、長度、與 info string。
 * 依 CommonMark:最多縮排 3 格,至少 3 個字元,而 ``` 的 info string 裡不能有反引號。
 */
function matchFence(line: string): { char: '`' | '~'; len: number; info: string } | undefined {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return undefined;
  const marker = m[1]!;
  const info = m[2]!.trim();
  const char = marker[0] as '`' | '~';
  if (char === '`' && info.includes('`')) return undefined;
  return { char, len: marker.length, info };
}

/**
 * 把 inline code(`x`)換成等長的空白。
 *
 * 照 CommonMark 的 code span 規則配對:開頭是一串 N 個反引號,收尾必須是**剛好 N 個**
 * 的另一串。用 /(`+)[\s\S]*?\1/ 這種非貪婪 regex 會在長度不同的反引號串上配錯——
 * 例如 docs/00-design.md 的 "- **範例放在 ` ```example ` 圍欄內**",單反引號開頭
 * 遇到中間那串 ``` 會被當成收尾,把後半行留下來當內文。所以這裡用掃的,不用 regex。
 */
function stripInlineCode(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i];
      i++;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] === '`') j++;
    const n = j - i; // 開頭這串反引號的長度

    let k = j;
    let end = -1;
    while (k < line.length) {
      if (line[k] !== '`') {
        k++;
        continue;
      }
      let e = k;
      while (e < line.length && line[e] === '`') e++;
      if (e - k === n) {
        end = e; // 找到剛好一樣長的收尾
        break;
      }
      k = e; // 長度不一樣,整串跳過,不能當收尾
    }

    if (end === -1) {
      // 沒有配對的收尾:這串反引號只是文字,原樣留著
      out += line.slice(i, j);
      i = j;
      continue;
    }
    out += ' '.repeat(end - i);
    i = end;
  }
  return out;
}

/**
 * 把 fenced code block 與 inline code 換成等長的空白,行號不變。
 *
 * 圍欄用一個 stack 逐行判定,不用 regex 去挖。原因是 docs/00-design.md:97-121 有
 * 真的巢狀圍欄:一段 ```markdown 裡面又寫了一行 ```example,再兩行 ``` 才收乾淨。
 * 用非貪婪的 /```[\s\S]*?```/ 會在 ```example 那裡提早收掉,於是區塊裡示範用的
 * `![同源判定流程](../../assets/sec-0042-sop.png)` 被當成真連結而誤報。
 *
 * 逐行的判定規則(top = stack 最上面那層):
 *   1. 沒有 top → 任何圍欄行都是開頭,push
 *   2. 有 top,但圍欄字元不同(``` 裡的 ~~~)→ 當內文,不 push 也不 pop
 *   3. 有 top,字元相同,**info string 是空的**且長度 >= top → 收尾,pop
 *   4. 有 top,字元相同,**有 info string** → 不能當收尾(CommonMark),當成巢狀的
 *      新一層,push
 *   5. 有 top,字元相同,沒有 info 但比 top 短 → 不能收尾,當內文
 */
export function stripCode(src: string): string {
  const stack: OpenFence[] = [];
  return src
    .split('\n')
    .map((line) => {
      const fence = matchFence(line);
      const top = stack[stack.length - 1];

      if (fence && (!top || fence.char === top.char)) {
        if (!top) {
          stack.push({ char: fence.char, len: fence.len });
          return blankLine(line);
        }
        if (fence.info === '' && fence.len >= top.len) {
          stack.pop();
          return blankLine(line);
        }
        if (fence.info !== '') {
          stack.push({ char: fence.char, len: fence.len });
          return blankLine(line);
        }
        // 沒有 info 但比 top 短:收不了尾,落到下面當內文
      }

      return stack.length ? blankLine(line) : stripInlineCode(line);
    })
    .join('\n');
}

/** `[文字](路徑)`、`![圖說](路徑)`,路徑後面可以跟 "title" / 'title' / (title)。 */
const LINK_RE =
  /!?\[[^\]\n]*\]\(\s*([^()\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;

/** 有 scheme 的(http: https: mailto: file:)一律當外部連結。 */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 從已經挖掉 code 的內文找出相對連結。
 * 回傳的 target 是原文(可能含錨點);外部連結與純錨點不回傳。
 */
export function findRelativeLinks(stripped: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(stripped)) !== null) {
    let target = m[1]!;
    // <./a b.md> 這種角括號形式,把括號去掉再看
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (!target) continue;
    if (target.startsWith('#')) continue; // 純錨點:同一篇裡跳轉
    if (target.startsWith('//')) continue; // protocol-relative,外部
    if (SCHEME_RE.test(target)) continue; // http: https: mailto: …
    out.push({ target, line: stripped.slice(0, m.index).split('\n').length });
  }
  return out;
}

function* walkMarkdown(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walkMarkdown(full);
    else if (name.endsWith('.md')) yield full;
  }
}

/** 掃描範圍:SCAN_DIRS 底下所有 .md,加上根目錄的 README*.md。 */
function markdownFiles(root: string): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) files.push(...walkMarkdown(join(root, dir)));
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const lower = name.toLowerCase();
      if (!lower.startsWith('readme') || !lower.endsWith('.md')) continue;
      const full = join(root, name);
      if (statSync(full).isFile()) files.push(full);
    }
  }
  return files;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** `./a.md#section` → `./a.md`;順便把 %20 這種百分號編碼還原。 */
function targetToPath(target: string): string {
  const withoutAnchor = target.split('#')[0]!;
  try {
    return decodeURIComponent(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

/**
 * 掃一個根目錄,回傳結果。不負責印東西,也不負責 process.exit。
 */
export function checkDocLinks(root: string): DocLinkResult {
  const broken: BrokenLink[] = [];
  let links = 0;

  const files = markdownFiles(root);
  for (const file of files) {
    const stripped = stripCode(readFileSync(file, 'utf8'));
    for (const { target, line } of findRelativeLinks(stripped)) {
      links++;
      const abs = resolve(dirname(file), targetToPath(target));
      if (existsSync(abs)) continue;
      broken.push({ file: toPosix(relative(root, file)), line, target });
    }
  }

  return { files: files.length, links, broken };
}

/**
 * CLI 入口。回傳退出碼與要印的字。
 */
export function main(argv: string[]): { code: number; output: string } {
  const i = argv.indexOf('--root');
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = resolve(rootArg ?? resolve(import.meta.dirname, '..'));

  const { files, links, broken } = checkDocLinks(root);
  const out: string[] = [];

  // 0 條連結跟「全部都對」的退出碼一樣是 0。掃描範圍打錯、副檔名清單改掉、
  // 或 stripCode 挖太多的時候就長這樣,所以一律當 FAIL。
  if (links === 0) {
    out.push(`doc-links: 掃描 ${files} 個 markdown 檔,掃描到 0 條相對連結`);
    out.push(`${SCANNER_BROKEN}。掃描範圍 SCAN_DIRS、副檔名、或 stripCode 挖太多時就長這樣。`);
    return { code: 1, output: out.join('\n') };
  }

  out.push(`doc-links: 掃描 ${files} 個 markdown 檔,${links} 條相對連結`);

  if (broken.length) {
    out.push(`\n✗ ${broken.length} 條連結指到不存在的檔案:`);
    for (const b of broken) out.push(`  ${b.file}:${b.line}  →  ${b.target}`);
    out.push('\n改了檔名或搬了目錄就要一起改指過去的連結;真的要指到還沒有的檔案就先別寫成連結。');
    return { code: 1, output: out.join('\n') };
  }

  out.push('✓ 連結全部都在');
  return { code: 0, output: out.join('\n') };
}

const isDirectRun = process.argv[1]?.endsWith('check-doc-links.ts') ?? false;
if (isDirectRun) {
  const { code, output } = main(process.argv.slice(2));
  console.log(output);
  process.exit(code);
}
