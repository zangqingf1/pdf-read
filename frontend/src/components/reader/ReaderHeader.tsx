import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useDocumentStore } from '../../stores/documentStore';
import { useReaderStore, BG_COLORS } from '../../stores/readerStore';
import PromptEditorModal from '../common/PromptEditorModal';
import Button from '../ui/Button';

export default function ReaderHeader() {
  const navigate = useNavigate();
  const { title } = useDocumentStore();
  const { bgColor } = useReaderStore();
  const bgColorValue = BG_COLORS.find(c => c.key === bgColor)?.value ?? BG_COLORS[0].value;
  const [showPromptModal, setShowPromptModal] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 border-b border-hairline h-[52px] px-6 flex items-center justify-between flex-shrink-0 transition-colors duration-300"
      style={{ backgroundColor: bgColorValue }}
    >
      <div className="flex items-center gap-6">
        <Button
          variant="ghost"
          size="sm"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          }
          onClick={() => navigate('/')}
        >
          返回
        </Button>
        <h2 className="text-base font-display font-medium text-ink truncate max-w-md m-0">
          {title || 'Untitled'}
        </h2>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowPromptModal(true)}
      >
        提示词
      </Button>

      <PromptEditorModal
        open={showPromptModal}
        onClose={() => setShowPromptModal(false)}
      />
    </header>
  );
}
