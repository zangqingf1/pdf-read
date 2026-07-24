import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import EditableParagraph from './EditableParagraph';
import type { ParagraphData } from './EditableParagraph';

interface SortableParagraphProps {
  paragraph: ParagraphData;
  isDirty: boolean;
  isLast: boolean;
  onChange: (index: number, text: string) => void;
  onDelete: (index: number) => void;
  onMergeDown: (index: number) => void;
}

export default function SortableParagraph(props: SortableParagraphProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.paragraph.cid });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <EditableParagraph
        {...props}
        dragHandleListeners={listeners}
      />
    </div>
  );
}
