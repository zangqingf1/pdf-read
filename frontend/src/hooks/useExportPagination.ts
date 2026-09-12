/**
 * 分页预览 hook：data/prefs 变化 → 180ms 防抖 → measureAndPaginate。
 * 防抖期间保留旧 plan；首次渲染返回 null（预览显示渲染中）。
 *
 * `getPlan` 复用已算好的 plan（data/prefs 引用未变时直接返回），
 * 导出按钮不再对整篇文档重复测量分页。
 *
 * `enabled=false`（弹窗未打开）时不排测量：measureAndPaginate 会对整篇文档
 * 逐字符取字形盒矩形，放在常挂载的组件里会随文档/译文每次变化触发。
 * 导出与预览都只在弹窗内可达，届时 `getPlan` 仍会按需现算。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { measureAndPaginate } from '../export/measure';
import type { PagePlan } from '../export/paginate';
import type { ExportData } from '../export/data';
import type { ExportPreferences } from '../export/exportTypes';

export function useExportPagination(
  data: ExportData,
  prefs: ExportPreferences,
  enabled: boolean = true
): { plan: PagePlan | null; getPlan: () => Promise<PagePlan> } {
  const [plan, setPlan] = useState<PagePlan | null>(null);
  const cacheRef = useRef<{ data: ExportData; prefs: ExportPreferences; plan: PagePlan } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const p = await measureAndPaginate(data, prefs);
        if (!cancelled) {
          setPlan(p);
          cacheRef.current = { data, prefs, plan: p };
        }
      } catch (e) {
        console.error('export pagination failed:', e);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [data, prefs, enabled]);

  /** 返回当前数据/偏好对应的分页 plan：已缓存（且引用未变）直接复用，否则现算 */
  const getPlan = useCallback(async (): Promise<PagePlan> => {
    const cached = cacheRef.current;
    if (cached && cached.data === data && cached.prefs === prefs) {
      return cached.plan;
    }
    const p = await measureAndPaginate(data, prefs);
    cacheRef.current = { data, prefs, plan: p };
    setPlan(p);
    return p;
  }, [data, prefs]);

  return { plan, getPlan };
}
