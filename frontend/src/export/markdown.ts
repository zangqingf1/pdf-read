/**
 * AI 输出（句子精讲 content / 全文总结）的最小 markdown 块切分器。
 * 按行扫描（空行 / 列表 / 标题分段），返回 markdown 源块数组；
 * 每块用 react-markdown 独立渲染（块间无跨块样式交互 → 碎片渲染与整块渲染一致）。
 */

/** markdown 文本 → 源块数组（每块是独立段落/列表/标题的 markdown 源码） */
export function splitMarkdownBlocks(md: string): string[] {
  const lines = (md ?? '').trim().split('\n');
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(listItems.join('\n'));
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    // 列表项：连续列表行合成一个块（保持 `- ` 标记，react-markdown 渲染为同一 <ul>）
    const isList = /^[-*•]\s+/.test(line) || /^\d+[.、]\s+/.test(line);
    if (isList) {
      listItems.push(line);
      continue;
    }
    flushList();
    blocks.push(line);
  }
  flushList();

  return blocks;
}
