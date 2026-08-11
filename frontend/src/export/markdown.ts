/**
 * AI 输出（句子精讲 content / 全文总结）的最小 markdown 子集 → HTML。
 * 输出以「块」数组返回（每块一个 <p>/<ul>/<h*>），便于按块碎片化分页。
 * 安全：所有文本先 escapeHtml 再进 HTML 字符串。
 */

/** 已知节标签名 → 主题内 CSS 类后缀（1=原句拆解 2=理解拆解 3=阅读线索 4=地道翻译） */
const SECTION_LABELS: Record<string, string> = {
  原句拆解: '1',
  理解拆解: '2',
  阅读线索: '3',
  地道翻译: '4',
  // 旧数据兼容（backend 早前格式）
  原文: '3',
  主干: '1',
  讲解: '2',
  译文: '4',
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 行内标记转换（输入需已转义） */
function inlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * markdown 文本 → HTML 块数组。
 * 支持：**加粗** *斜体* `代码`、- / * / 1. 列表、#~#### 标题、空行分段、
 * 段首「**已知标签**：内容」（冒号在标签外或内）→ 彩色节标签。
 */
export function mdToHtml(md: string): string[] {
  const lines = escapeHtml(md.trim()).split('\n');
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    // 列表项
    const listMatch = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+[.、]\s+(.*)$/);
    if (listMatch) {
      listItems.push(`<li>${inlineMd(listMatch[1])}</li>`);
      continue;
    }
    flushList();

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      blocks.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    // 段首节标签：**标签**：内容（标签在 strong 内，冒号在内外均可）
    const sec = line.match(/^\*\*([^*]+)\*\*[：:]?\s*(.*)$/);
    if (sec && SECTION_LABELS[sec[1].trim()]) {
      const label = sec[1].trim();
      const rest = sec[2];
      const cls = `ep-sec-label ep-sec-${SECTION_LABELS[label]}`;
      blocks.push(`<p><span class="${cls}">${label}</span>${rest ? ` ${inlineMd(rest)}` : ''}</p>`);
      continue;
    }

    blocks.push(`<p>${inlineMd(line)}</p>`);
  }
  flushList();

  return blocks;
}
