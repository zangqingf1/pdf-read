/**
 * 句子解析 markdown 分区标题 → 标签配色（阅读页解析卡片共用单一来源）。
 * 含旧数据兼容键（原文/主干/讲解/译文）。配色与导出 PDF 的 ep-sec-* 保持同族。
 */
export const SENTENCE_HEADER_STYLES: Record<string, string> = {
  原句拆解: 'bg-[#fdf3ef] text-[#b85c3a] border border-[#e8c9b8]',
  理解拆解: 'bg-[#f0f5ec] text-[#5d7d52] border border-[#c5d8b8]',
  阅读线索: 'bg-[#eef2f7] text-[#5f6f8a] border border-[#bccadf]',
  地道翻译: 'bg-[#faf3df] text-[#8a6d3b] border border-[#e5d4a2]',
  // 旧数据兼容
  原文: 'bg-[#eef2f7] text-[#5f6f8a] border border-[#bccadf]',
  主干: 'bg-[#fdf3ef] text-[#b85c3a] border border-[#e8c9b8]',
  讲解: 'bg-[#f0f5ec] text-[#5d7d52] border border-[#c5d8b8]',
  译文: 'bg-[#eef2f7] text-[#5f6f8a] border border-[#bccadf]',
};
