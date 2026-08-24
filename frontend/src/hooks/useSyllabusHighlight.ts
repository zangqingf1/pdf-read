import { useEffect, useMemo } from 'react';
import { useDocumentStore } from '../stores/documentStore';
import { useReaderStore } from '../stores/readerStore';
import { tokenizeWords } from '../utils/textTokens';
import { syllabusMatch } from '../services/wordAnalysisApi';

/**
 * 阅读页考纲标注引擎：
 * - 从 readerStore 读取所选考纲（多选，与解析卡片显隐过滤独立）；
 * - 收集当前文档全部去重词元 → POST /words/syllabus-match 批量判定
 *   （后端 ECDICT 离线匹配 + 屈折还原），命中集合写入 documentStore；
 * - 结果按「文档 + 考纲组合」模块级缓存；正文编辑后（文本指纹变化）自动重算。
 */
const _CACHE_MAX = 20;
/** key: `${documentId}::${sortedTags}` → 命中词形集合（小写） */
const _resultCache = new Map<string, Set<string>>();
/** 已应用过的 `${cacheKey}::${textHash}` — 正文变化后即使有缓存也重算 */
const _appliedKeys = new Set<string>();

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `${h}_${s.length}`;
}

export function useSyllabusHighlight(): void {
  const documentId = useDocumentStore((s) => s.documentId);
  const paragraphs = useDocumentStore((s) => s.paragraphs);
  const setSyllabusWords = useDocumentStore((s) => s.setSyllabusWords);
  const syllabusTags = useReaderStore((s) => s.syllabusTags);

  const tagKey = useMemo(() => [...syllabusTags].sort().join(','), [syllabusTags]);
  const textFingerprint = useMemo(
    () => djb2Hash(paragraphs.map((p) => p.text).join('\u0000')),
    [paragraphs]
  );

  useEffect(() => {
    if (!documentId || !tagKey) {
      setSyllabusWords(null);
      return;
    }
    const cacheKey = `${documentId}::${tagKey}`;
    const appliedKey = `${cacheKey}::${textFingerprint}`;

    const seq = ++useSyllabusHighlight._seq;
    const applyIfCurrent = (set: Set<string>) => {
      if (seq === useSyllabusHighlight._seq) setSyllabusWords(set);
    };

    const cached = _resultCache.get(cacheKey);
    if (cached && _appliedKeys.has(appliedKey)) {
      applyIfCurrent(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let matchedSet: Set<string>;
        if (cached && !cancelled) {
          // 同文档同考纲已有结果但正文变了 → 只需补查新出现的词
          const stems = collectStems(paragraphs);
          const missing = [...stems].filter((w) => !cached.has(w));
          if (missing.length === 0) {
            matchedSet = cached;
          } else {
            const extra = await syllabusMatch(syllabusTags, missing);
            matchedSet = new Set([...cached, ...extra]);
          }
        } else {
          const stems = collectStems(paragraphs);
          const matched = await syllabusMatch(syllabusTags, [...stems]);
          matchedSet = new Set(matched);
        }
        if (cancelled) return;
        if (_resultCache.size >= _CACHE_MAX) {
          const oldest = _resultCache.keys().next().value;
          if (oldest !== undefined) {
            _resultCache.delete(oldest);
            for (const k of _appliedKeys) {
              if (k.startsWith(`${oldest}::`)) _appliedKeys.delete(k);
            }
          }
        }
        _resultCache.set(cacheKey, matchedSet);
        _appliedKeys.add(appliedKey);
        applyIfCurrent(matchedSet);
      } catch {
        // 考纲高亮失败静默降级 — 不影响正常阅读
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, tagKey, textFingerprint, setSyllabusWords, syllabusTags, paragraphs]);
}

function collectStems(paragraphs: Array<{ text: string }>): Set<string> {
  const stems = new Set<string>();
  for (const p of paragraphs) {
    for (const t of tokenizeWords(p.text)) {
      if (t.stem) stems.add(t.stem.toLowerCase());
    }
  }
  return stems;
}

// 挂在函数对象上的自增序号：仅保留最新一次 effect 的写入权
useSyllabusHighlight._seq = 0;
