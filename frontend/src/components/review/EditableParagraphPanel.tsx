import { useMemo, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import PageGroup from './PageGroup';
import type { ParagraphData } from './EditableParagraph';

interface EditableParagraphPanelProps {
  paragraphs: ParagraphData[];
  dirtySet: Set<number>;
  onParagraphChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
  onReorder: (activeCid: string, overCid: string) => void;
}

export default function EditableParagraphPanel({
  paragraphs,
  dirtySet,
  onParagraphChange,
  onDelete,
  onMergeDown,
  onReorder,
}: EditableParagraphPanelProps) {
  const pageGroups = useMemo(() => {
    const groups: Map<number | null, ParagraphData[]> = new Map();

    for (const para of paragraphs) {
      const key = para.page_number ?? null;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(para);
    }

    const entries = Array.from(groups.entries());
    entries.sort(([a], [b]) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });

    return entries;
  }, [paragraphs]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      onReorder(active.id as string, over.id as string);
    },
    [onReorder],
  );

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {pageGroups.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          暂无段落数据
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={paragraphs.map((p) => p.cid)}
            strategy={verticalListSortingStrategy}
          >
            {pageGroups.map(([pageNumber, paras]) => (
              <PageGroup
                key={pageNumber ?? '__other__'}
                pageNumber={pageNumber}
                paragraphs={paras}
                dirtySet={dirtySet}
                onParagraphChange={onParagraphChange}
                onDelete={onDelete}
                onMergeDown={onMergeDown}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
