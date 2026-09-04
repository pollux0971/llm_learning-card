// SOURCE: template v1.3.2 (7eecc51) sha256=5d1a9e0b58ca10d7875a535a2f3db2085912f04f794d4a4eb6e93dc9ceb2056c — 勿手改;升版用 sync-gates.sh
/**
 * 文件連結檢查(見 docs/03-agile-workflow.md「文件漂移」維護項)。
 *
 * 掃描根目錄、docs/、features/、contracts/、.claude/ 底下的 *.md,抓 markdown 相對連結
 * `[text](path)`,確認目標檔案或目錄存在。文件裡的相對連結是唯一沒有編譯器、
 * 沒有測試會幫你檢查的東西——檔案搬走、改名之後,連結安靜地爛掉,直到有人手動點才發現。
 * `.claude/` 底下是 commands / rules / skills,agent 每次載入都會讀,壞連結的代價比一般 docs 更貴。
 *
 * 規則(掃描器邏輯移植自主 repo scripts/check-doc-links.ts,真正照 CommonMark 的圍欄規則):
 *   1. 掃描範圍:repo 根目錄下直接的 *.md(不遞迴),加上 docs/、features/、contracts/、
 *      .claude/ 底下遞迴的所有 *.md;排除任何路徑含內建預設片段(node_modules、
 *      .stryker-tmp、dist、.git、target、.svelte-kit、archive)的檔案,以及
 *      .claude/worktrees/、contracts/fixtures/ 這兩個子樹(worktree 是暫存的,
 *      fixtures 是刻意造的測試資料,兩邊都不是「文件」)。這份排除清單可以用
 *      `scripts/gates.config.json` 的 `docLinks.skipSegments` / `docLinks.skipPrefixes`
 *      **追加**(不是取代)——專案有自己的建置產物目錄名時不必改這支程式。實際生效的
 *      排除清單會印在輸出第一行。
 *   2. 排除 fenced code block(``` 與 ~~~)與 inline code(`x`)裡的東西,規則跟 CommonMark
 *      一致:收尾圍欄要跟開頭同字元、無 info string、長度 >= 開頭;最多縮排 3 格;
 *      inline code 的收尾必須是**剛好一樣長**的反引號串,不能用非貪婪 regex 配錯
 *      (docs/00-design.md:97-121 有巢狀圍欄,``` 裡面又有一行帶 info string 的 ```example,
 *      提早收掉會把示範用的假連結當真連結誤報)
 *   3. 抓 `[text](path)` 形式的連結(含圖片 `![alt](path)` 的 path 部分,以及
 *      `[text](path "title")` / `[text](<path>)` 這些變體);排除 http(s): mailto: 等
 *      有 scheme 的、protocol-relative `//host/x`、純錨點 `#...`;path 裡的 `#fragment`
 *      一律去掉再判斷,並還原 %20 這種百分號編碼
 *   4. 目標相對於「連結所在檔案」所在目錄解析,要求該路徑存在(檔案或目錄都算通過)
 *   5. **掃到 0 條連結也要 FAIL**:0 條跟「全部都對」的退出碼一樣是 0,
 *      那是掃描範圍或 stripCode 壞了,不是文件很乾淨(同 check-boundaries / check-standalone)
 *
 * 用法(repo 根從 `git rev-parse --show-toplevel` 解析,不在 git repo 裡則退回 cwd;
 * `--root <dir>` 明講的話優先於這個推定,測試與跑在別的 repo 上時用):
 *   npx tsx scripts/check-doc-links.ts               # 複製進 repo 後執行
 *   npx tsx <template>/scripts/check-doc-links.ts    # 從模板路徑直接執行,cwd 需在目標 repo
 *   npx tsx scripts/check-doc-links.ts --root <dir>  # 明講根目錄
 *
 * 退出碼:
 *   0  沒有壞掉的連結
 *   1  有連結指向不存在的路徑;或掃到 0 條連結(這不是很乾淨,是掃描器壞了)
 *
 * 反向驗證(改完要還原,不要留下改動):
 *   (a) 找一份現有 .md(例如 docs/01-roadmap.md)裡一條指向真實檔案的相對連結
 *       (例如指到某個 FEATURE.md),把它的路徑改成明顯不存在的檔名(加個 -broken 後綴)。
 *       重跑這支腳本 → 應該紅,列出那個檔案:行號 → 壞掉的目標。
 *   (b) 改回原本的路徑 → 重跑 → 應該綠。
 *   (c) 順手確認:把同一條連結包進反引號(變成 code span)重跑 → 不該被當成連結抓到
 *       (驗證「code span 裡的不算連結」這條規則),測完記得拿掉反引號、還原檔案。
 *   (d) 排除清單設定化:在 dist/、.svelte-kit/ 底下各放一個含壞連結的 .md → 預設就該
 *       排除,不報。在掃描範圍內(例如 docs/)放一個含壞連結的 .md → 應該報。
 *       在 `scripts/gates.config.json` 加 `"docLinks": {"skipSegments": ["docs"]}` →
 *       docs/ 底下的壞連結不再報(驗證「追加」的是這份 config,不是取代預設)。
 *       測完把加的檔案與 gates.config.json 的改動都還原。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT as GIT_ROOT } from './_root.js';

/** 這支腳本在 gate 機器可讀標記(見 CHANGELOG 1.3.2 (C))裡的名字。 */
const GATE_NAME = 'doc-links';

/** 遞迴掃描這些目錄底下的 *.md。根目錄的 *.md 另外處理(不遞迴)。 */
export const SCAN_DIRS = ['docs', 'features', 'contracts', '.claude'];

/** 三支掃描器共用的那句話。0 個東西的紅,方向永遠是「掃描器壞了」。 */
export const SCANNER_BROKEN = '這不是很乾淨,是掃描器壞了';

/**
 * 走目錄時,名字完全等於這些就跳過整個子樹(任何深度都算)。
 * 跟主 repo 版 `scripts/check-doc-links.ts` 的 SKIP_DIRS 同步(node_modules、.git、
 * dist、target、.svelte-kit),另加 `.stryker-tmp`(變異測試暫存)與 `archive`
 * (模板專屬,主 repo 沒有這個慣例目錄)。1.2.0/1.2.1 掉了 dist/.git/target/.svelte-kit
 * 四個是迴歸(見 CHANGELOG 1.2.2)。
 */
const DEFAULT_SKIP_SEGMENTS = ['node_modules', '.stryker-tmp', 'dist', '.git', 'target', '.svelte-kit', 'archive'];
/** 路徑前綴(相對於 ROOT,posix 分隔),整個子樹排除。 */
const DEFAULT_SKIP_PREFIXES = ['.claude/worktrees', 'contracts/fixtures'];

interface GatesConfig {
  docLinks?: { skipSegments?: unknown; skipPrefixes?: unknown };
}

/**
 * 找 `gates.config.json` 的順序:(1) 這支腳本自己所在的目錄(sync 後就是 consumer 的
 * 安裝目錄,例如 `features/scripts/`)、(2) `<root>/scripts/`——`root` 是呼叫端傳進來的
 * 那個(預設 `GIT_ROOT`,`--root` 覆蓋時是覆蓋值),不是寫死的全域 ROOT,因為這支腳本
 * 支援對別的 repo 跑(`--root <dir>`,verify-against.sh 用得到)。兩處都沒有 → 用內建預設,
 * 這份檔本來就是選填設定,不印任何訊息(見 CHANGELOG 1.3.2 (A))。
 */
function loadGatesConfig(root: string): GatesConfig {
  const candidates = [join(import.meta.dirname, 'gates.config.json'), join(root, 'scripts', 'gates.config.json')];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as GatesConfig;
    } catch {
      return {};
    }
  }
  return {};
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

export interface SkipConfig {
  skipSegments: string[];
  skipPrefixes: string[];
}

/**
 * 內建預設 + `scripts/gates.config.json` 的 `docLinks.skipSegments` / `docLinks.skipPrefixes`
 * **追加**(不是取代;去重)。這份檔不存在或沒填這兩個欄位就只用內建預設。
 */
export function resolveSkipConfig(root: string): SkipConfig {
  const docLinks = loadGatesConfig(root).docLinks ?? {};
  const skipSegments = [...new Set([...DEFAULT_SKIP_SEGMENTS, ...stringArray(docLinks.skipSegments)])];
  const skipPrefixes = [...new Set([...DEFAULT_SKIP_PREFIXES, ...stringArray(docLinks.skipPrefixes)])];
  return { skipSegments, skipPrefixes };
}

interface BrokenLink { file: string; line: number; target: string }

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
 * 例如 "- **範例放在 ` ```example ` 圍欄內**",單反引號開頭遇到中間那串 ``` 會被當成
 * 收尾,把後半行留下來當內文。所以這裡用掃的,不用 regex。
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
 * 圍欄用一個 stack 逐行判定,不用 regex 去挖。原因是有些文件有真的巢狀圍欄:一段
 * ```markdown 裡面又寫了一行 ```example,再兩行 ``` 才收乾淨。用非貪婪的
 * /```[\s\S]*?```/ 會在 ```example 那裡提早收掉,於是區塊裡示範用的假連結
 * 被當成真連結而誤報。
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

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** 這個相對於 ROOT 的路徑(posix)要不要整個跳過(整段子樹排除)。 */
function isSkipped(relPath: string, skip: SkipConfig): boolean {
  const posix = toPosix(relPath);
  if (posix.split('/').some((seg) => skip.skipSegments.includes(seg))) return true;
  return skip.skipPrefixes.some((prefix) => posix === prefix || posix.startsWith(`${prefix}/`));
}

function* walkMd(dir: string, relDir: string, skip: SkipConfig): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    if (isSkipped(rel, skip)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walkMd(full, rel, skip);
    else if (name.endsWith('.md')) yield full;
  }
}

/** 掃描範圍:根目錄直接的 *.md(不遞迴)聯集 SCAN_DIRS 底下遞迴的所有 *.md。 */
function markdownFiles(root: string, skip: SkipConfig): string[] {
  const files: string[] = [];
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const full = join(root, name);
      if (name.endsWith('.md') && statSync(full).isFile()) files.push(full);
    }
  }
  for (const dir of SCAN_DIRS) files.push(...walkMd(join(root, dir), dir, skip));
  return files;
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
 * `skip` 不給就用 `resolveSkipConfig(root)`(內建預設 + 該 root 的 gates.config.json)。
 */
export function checkDocLinks(root: string, skip: SkipConfig = resolveSkipConfig(root)): DocLinkResult {
  const broken: BrokenLink[] = [];
  let links = 0;

  const files = markdownFiles(root, skip);
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
 * CLI 入口。回傳退出碼與要印的字。argv 明講 `--root` 就用那個,
 * 否則用 `_root.ts` 從 git 推定出的 repo 根。
 */
export function main(argv: string[]): { code: number; output: string } {
  const i = argv.indexOf('--root');
  const rootArg = i >= 0 ? argv[i + 1] : undefined;
  const root = resolve(rootArg ?? GIT_ROOT);
  const skip = resolveSkipConfig(root);

  const { files, links, broken } = checkDocLinks(root, skip);
  const out: string[] = [];

  out.push(`doc-links: 排除片段 [${skip.skipSegments.join(', ')}]、排除前綴 [${skip.skipPrefixes.join(', ')}]`);

  // 0 條連結跟「全部都對」的退出碼一樣是 0。掃描範圍打錯、副檔名清單改掉、
  // 或 stripCode 挖太多的時候就長這樣,所以一律當 FAIL。
  if (links === 0) {
    out.push(`doc-links: 掃描 ${files} 個 markdown 檔,掃描到 0 條相對連結`);
    out.push(`${SCANNER_BROKEN}。掃描範圍 SCAN_DIRS、副檔名、或 stripCode 挖太多時就長這樣。`);
    out.push(`gate=${GATE_NAME} result=FAIL scanned=0`);
    return { code: 1, output: out.join('\n') };
  }

  out.push(`doc-links: 掃描 ${files} 個 markdown 檔,${links} 條相對連結`);

  if (broken.length) {
    out.push(`\n✗ ${broken.length} 條連結指到不存在的檔案:`);
    for (const b of broken) out.push(`  ${b.file}:${b.line}  →  ${b.target}`);
    out.push('\n改了檔名或搬了目錄就要一起改指過去的連結;真的要指到還沒有的檔案就先別寫成連結。');
    out.push(`gate=${GATE_NAME} result=FAIL scanned=${links}`);
    return { code: 1, output: out.join('\n') };
  }

  out.push('✓ 無壞掉的連結');
  out.push(`gate=${GATE_NAME} result=PASS scanned=${links}`);
  return { code: 0, output: out.join('\n') };
}

const isDirectRun = process.argv[1]?.endsWith('check-doc-links.ts') ?? false;
if (isDirectRun) {
  const { code, output } = main(process.argv.slice(2));
  console.log(output);
  process.exit(code);
}
