/**
 * 导出预览：modal 左侧视口，显示分页后的纸张效果（多页纵向排列）。
 * CSS zoom 缩放适配视口宽度；测量在 body 级离屏宿主进行，不受 zoom 影响。
 * plan 由父级（ExportSettingsModal）通过 useExportPagination 计算，
 * 导出按钮与其共享同一份分页结果，避免重复测量。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ExportPages from '../../export/ExportPages';
import { PAPER_SIZES } from '../../export/exportTypes';
import { useExportPreferences } from '../../stores/exportPreferencesStore';
import { pickExportPrefs } from '../../stores/exportPreferencesStore';
import type { ExportPreferences } from '../../export/exportTypes';
import type { PagePlan } from '../../export/paginate';
import type { ExportData } from '../../export/data';

export default function ExportPreview({
  data,
  plan,
}: {
  data: ExportData;
  plan: PagePlan | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const store = useExportPreferences();
  const prefs: ExportPreferences = useMemo(() => pickExportPrefs(store), [store]);
  const paperW = PAPER_SIZES[prefs.paperSize].wPx;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      setScale(Math.min(1, (el.clientWidth - 24) / paperW));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paperW]);

  return (
    <div ref={viewportRef} className="flex-1 min-w-0 overflow-auto p-4 bg-canvas-soft">
      <div className="mx-auto" style={{ zoom: scale, width: 'fit-content' }}>
        {plan ? (
          <ExportPages data={data} prefs={prefs} plan={plan} preview />
        ) : (
          <div className="py-16 px-10 text-sm text-muted-soft">预览渲染中…</div>
        )}
      </div>
    </div>
  );
}
