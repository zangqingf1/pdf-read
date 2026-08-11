/**
 * 句子解析 content 分节工具。
 * 把 AI 输出的 markdown（**原句拆解**：/**理解拆解**：...）拆成 {name, text} 节，
 * 供「原句拆解直接作为句子标题」的渲染复用 —— 导出（exportBlocks）与解析面板（StudyPanel/FocusedAnalysisSheet）行为一致。
 */

export interface SentenceSection {
  name: string;
  text: string;
}

/** 已知句子解析节名（含旧格式兼容：原文/主干/讲解/译文） */
export const SENTENCE_SECTION_NAMES: ReadonlySet<string> = new Set([
  '原句拆解',
  '理解拆解',
  '阅读线索',
  '地道翻译',
  '原文',
  '主干',
  '讲解',
  '译文',
]);

/** 按「**节名**：内容」结构分节（兼容旧格式冒号在 strong 内）；无法识别任何节时返回 null */
export function splitSentenceSections(content: string): SentenceSection[] | null {
  const sections: SentenceSection[] = [];
  let cur: SentenceSection | null = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*\*\*(.+?)\*\*\s*(.*)$/);
    if (m) {
      const name = m[1].replace(/[：:]\s*$/, '').trim();
      if (SENTENCE_SECTION_NAMES.has(name)) {
        cur = { name, text: m[2].replace(/^[：:]\s*/, '') };
        sections.push(cur);
        continue;
      }
    }
    if (cur) cur.text += (cur.text ? '\n' : '') + line;
  }
  return sections.length > 0 ? sections : null;
}

/** 正文 markdown：移除已上移到标题的「原句拆解」节（无分节/无此节时原样返回）；
 *  可选 exclude 额外排除节（导出时按偏好关掉 阅读线索/地道翻译） */
export function sentenceBodyMarkdown(content: string, exclude?: ReadonlySet<string>): string {
  const sections = splitSentenceSections(content);
  if (!sections) return content;
  const rest = sections.filter((s) => s.name !== '原句拆解' && !(exclude && exclude.has(s.name)));
  return rest.length === 0 ? '' : rest.map((s) => `**${s.name}**：${s.text.trim()}`).join('\n\n');
}

/** 「原句拆解」节文本（按原词序 / 切割的原文）；无则返回 null（标题回退为原句纯文本） */
function sentenceBreakdown(content: string): string | null {
  const sections = splitSentenceSections(content);
  const text = sections?.find((s) => s.name === '原句拆解')?.text.trim();
  return text ? text : null;
}

/** 原句拆解 → 语块数组（按 / 分隔、去 markdown 标记字符）；无拆解时返回 null */
export function sentenceBreakdownChunks(content: string): string[] | null {
  const breakdown = sentenceBreakdown(content);
  if (!breakdown) return null;
  const chunks = breakdown.split(/\s+\/\s+/).map((c) => c.trim()).filter(Boolean);
  return chunks.length > 0 ? chunks.map((c) => c.replace(/[*_`]/g, '')) : null;
}
