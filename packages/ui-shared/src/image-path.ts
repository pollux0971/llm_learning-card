/**
 * 卡片裡圖片路徑的解析(T46,契約 §12 / §13 的 UI 收緊)。
 *
 * 輸入是「卡片檔所在目錄」與 markdown 原文路徑(markdown-it 跳脫處理過、normalizeLink 之前)。
 * 相對於卡片目錄走完 `..` 之後,第一段必須是最上層 `assets`,而且整串過 §13 白名單。
 * 不解碼、不把 `.` 段或空段正規化掉(那些一律拒絕)。
 */

export type ImagePathResult = { ok: true; path: string } | { ok: false; reason: string };

/** §13 第 6 條。不含 COM0 / LPT0。¹²³ 是 U+00B9 U+00B2 U+00B3。 */
const RESERVED_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...'123456789'.split('').flatMap((n) => [`com${n}`, `lpt${n}`]),
  ...['¹', '²', '³'].flatMap((s) => [`com${s}`, `lpt${s}`]),
]);

/** ASCII 的 A–Z a–z 0–9 _ - .,或 Unicode 一般類別 L、N、M。 */
const SEGMENT_CHARS = /^[\p{L}\p{N}\p{M}_.-]+$/u;

const MAX_BYTES = 240;

function refuse(reason: string): ImagePathResult {
  return { ok: false, reason };
}

/** 只摺 A–Z,不用依語系變化的 toLowerCase。 */
function asciiFold(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function segmentRefused(seg: string): string | undefined {
  if (seg.startsWith('.') || seg.endsWith('.')) return 'dot';
  if (!SEGMENT_CHARS.test(seg)) return 'charset';
  if (seg.normalize('NFC') !== seg) return 'nfc';
  if (RESERVED_STEMS.has(asciiFold(seg.split('.')[0] ?? seg))) return 'reserved';
  return undefined;
}

/**
 * 把卡片原文裡的圖片路徑解析成 learning 相對路徑。
 * `cardDir` 是卡片檔所在目錄(例如 `cards/demo`),不含檔名。
 */
export function resolveImagePath(cardDir: string, rawPath: string): ImagePathResult {
  if (rawPath.length === 0) return refuse('empty');
  // 反斜線從來不是這裡的分隔符;含它的路徑意義取決於作業系統,拒絕。
  if (rawPath.includes('\\')) return refuse('backslash');
  // 絕對路徑、協定相對網址:開頭的斜線會在分段時變成空段,這裡先擋掉比較清楚。
  if (rawPath.startsWith('/')) return refuse('absolute');

  const stack = cardDir.length === 0 ? [] : cardDir.split('/');
  for (const seg of rawPath.split('/')) {
    if (seg === '..') {
      if (stack.length === 0) return refuse('escape');
      stack.pop();
      continue;
    }
    // `.` 與空段不正規化,一律拒絕(交給 assetUrl 的字串不能含這兩種段)。
    if (seg === '.' || seg.length === 0) return refuse('dot-or-empty');
    stack.push(seg);
  }

  // 解析完才看第一段:必須是最上層 assets,而且要有檔(不能只剩 assets 本身)。
  if (stack.length < 2 || stack[0] !== 'assets') return refuse('not-assets');

  const path = stack.join('/');
  if (path.normalize('NFC') !== path) return refuse('nfc');
  if (new TextEncoder().encode(path).length > MAX_BYTES) return refuse('length');
  for (const seg of stack) {
    const reason = segmentRefused(seg);
    if (reason) return refuse(reason);
  }
  return { ok: true, path };
}
