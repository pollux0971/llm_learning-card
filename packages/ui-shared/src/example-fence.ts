import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance, RendererRule, StateInline, Token } from 'markdown-it';
import { resolveImagePath } from './image-path.js';

/** class 掛在渲染出來的 example 容器上,教學卡與考試卡共用同一個名字。 */
export const EXAMPLE_CLASS = 'lc-example';

export interface RenderMarkdownOptions {
  /** 卡片檔所在目錄,例如 `cards/demo`。圖片路徑相對於它解析。 */
  cardDir: string;
  /** 解析後的 learning 相對路徑 → 網址。丟錯就當路徑不能用。 */
  assetUrl: (relPath: string) => string;
  /**
   * 例子一開始是否展開。沒傳 = 展開。
   * 只在產出 HTML 時決定 `open`,呼叫端不要在掛上去之後才改。
   */
  examplesOpen?: boolean;
}

interface MarkdownEnv {
  examplesOpen: boolean;
  [key: string | symbol]: unknown;
}

function fenceLang(info: string): string {
  return info.trim().split(/\s+/)[0] ?? '';
}

/** 這一輪 token 裡,第 idx 個 example 圍欄的標題。一個寫「例子」,多個寫「例子 N」。編號不跨次累加。 */
function exampleLabel(tokens: Token[], idx: number): string {
  let total = 0;
  let index = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.type !== 'fence' || fenceLang(token.info) !== 'example') continue;
    total += 1;
    if (i === idx) index = total;
  }
  if (total <= 1) return '例子';
  return `例子 ${index}`;
}

function examplesOpen(env: unknown): boolean {
  if (!env || typeof env !== 'object' || !('examplesOpen' in env)) return true;
  return (env as MarkdownEnv).examplesOpen !== false;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refusedImage(rawPath: string): string {
  return `圖片路徑不能用:${escapeHtml(rawPath)}`;
}

type ImageRule = (state: StateInline, silent: boolean) => boolean;

/**
 * 圖片規則與內文、例子共用:拿 token 的原文路徑(normalizeLink 之前),
 * 過了才把 assetUrl 的回傳值放進 src,不過就輸出佔位字樣(跳脫過)。
 */
function installAssetImages(md: MarkdownItInstance, options: RenderMarkdownOptions): void {
  const originalNormalize = md.normalizeLink.bind(md);
  let capturing = false;
  let captured: string | undefined;
  md.normalizeLink = (url: string) => {
    if (capturing && captured === undefined) captured = url;
    return originalNormalize(url);
  };

  const rule = md.inline.ruler.__rules__.find((item) => item.name === 'image');
  if (!rule) throw new Error('markdown-it 沒有 image 規則');
  const originalImage = rule.fn as ImageRule;
  md.inline.ruler.at('image', (state, silent) => {
    // 解析 alt 時會再進這條規則。巢狀呼叫不能清掉外層已經抓到的原文路徑。
    const saved = { capturing, captured };
    capturing = true;
    captured = undefined;
    let ok = false;
    let mine: string | undefined;
    try {
      ok = originalImage(state, silent);
      mine = captured;
    } finally {
      capturing = saved.capturing;
      captured = saved.captured;
    }
    if (ok && !silent && mine !== undefined) {
      const token = state.tokens[state.tokens.length - 1];
      if (token && token.type === 'image') {
        token.meta = { ...(token.meta ?? {}), rawSrc: mine };
      }
    }
    return ok;
  });

  const defaultImage: RendererRule =
    md.renderer.rules.image ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));

  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]!;
    const rawSrc = token.meta && typeof token.meta.rawSrc === 'string' ? token.meta.rawSrc : undefined;
    if (rawSrc === undefined) return defaultImage(tokens, idx, opts, env, self);
    const resolved = resolveImagePath(options.cardDir, rawSrc);
    if (!resolved.ok) return refusedImage(rawSrc);
    let url: string;
    try {
      url = options.assetUrl(resolved.path);
    } catch {
      return refusedImage(rawSrc);
    }
    const alt = escapeHtml(token.content);
    return `<img src="${escapeHtml(url)}" alt="${alt}" data-asset-path="${escapeHtml(resolved.path)}">`;
  };
}

/**
 * markdown-it 的 fence 插件:lang 為 `example` 的圍欄遞迴 render 為巢狀 markdown
 * (見 contracts/types.md §2「Example 圍欄」),其他語言(含沒寫語言、`examples` 這種近似字)
 * 一律走原本的 code 渲染,不受影響。
 * 例子輸出 `<details class="lc-example">`;展開與否看 env.examplesOpen(沒設就展開)。
 */
export function exampleFencePlugin(md: MarkdownItInstance): void {
  const defaultFence: RendererRule =
    md.renderer.rules.fence ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    if (fenceLang(token.info) !== 'example') return defaultFence(tokens, idx, options, env, self);
    const open = examplesOpen(env) ? ' open' : '';
    const inner = md.render(token.content, env);
    return `<details class="${EXAMPLE_CLASS}"${open}><summary>${exampleLabel(tokens, idx)}</summary>\n${inner}</details>\n`;
  };
}

/** 建立一個已裝好 example 圍欄插件的 markdown-it 實例。 */
export function createMarkdownRenderer(): MarkdownItInstance {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.use(exampleFencePlugin);
  return md;
}

/** 渲染一段 markdown(教學卡 body,或任何巢狀 markdown 片段)為 HTML。不帶選項時圖片路徑原樣。 */
export function renderMarkdown(source: string, options?: RenderMarkdownOptions): string {
  const md = createMarkdownRenderer();
  if (options) installAssetImages(md, options);
  const env: MarkdownEnv = { examplesOpen: options?.examplesOpen !== false };
  return md.render(source, env);
}
