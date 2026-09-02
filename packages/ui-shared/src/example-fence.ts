import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance, RendererRule } from 'markdown-it';

/** class 掛在渲染出來的 example 容器上,教學卡與考試卡共用同一個名字。 */
export const EXAMPLE_CLASS = 'lc-example';

/**
 * markdown-it 的 fence 插件:lang 為 `example` 的圍欄遞迴 render 為巢狀 markdown
 * (見 contracts/types.md §2「Example 圍欄」),其他語言(含沒寫語言、`examples` 這種近似字)
 * 一律走原本的 code 渲染,不受影響。
 */
export function exampleFencePlugin(md: MarkdownItInstance): void {
  const defaultFence: RendererRule =
    md.renderer.rules.fence ?? ((tokens, idx, options) => md.renderer.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const lang = token.info.trim().split(/\s+/)[0] ?? '';
    if (lang !== 'example') return defaultFence(tokens, idx, options, env, self);
    const inner = md.render(token.content, env);
    return `<div class="${EXAMPLE_CLASS}">\n${inner}</div>\n`;
  };
}

/** 建立一個已裝好 example 圍欄插件的 markdown-it 實例。 */
export function createMarkdownRenderer(): MarkdownItInstance {
  const md = new MarkdownIt({ html: false, linkify: true });
  md.use(exampleFencePlugin);
  return md;
}

/** 渲染一段 markdown(教學卡 body,或任何巢狀 markdown 片段)為 HTML。 */
export function renderMarkdown(source: string): string {
  return createMarkdownRenderer().render(source);
}
