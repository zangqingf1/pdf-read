/**
 * 分页预览 hook：data/prefs 变化 → 180ms 防抖 → measureAndPaginate。
 * 防抖期间保留旧 plan；首次渲染返回 null（预览显示渲染中）。
 */
import { useEffect, useState } from 'react';
import { measureAndPaginate } from '../export/measure';
import type { PagePlan } from '../export/paginate';
import type { ExportData } from '../export/data';
import type { ExportPreferences } from '../export/exportTypes';

export function useExportPagination(
  data: ExportData,
  prefs: ExportPreferences
): PagePlan | null {
  const [plan, setPlan] = useState<PagePlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const p = await measureAndPaginate(data, prefs);
        if (!cancelled) setPlan(p);
      } catch (e) {
        console.error('export pagination failed:', e);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [data, prefs]);

  return plan;
}
