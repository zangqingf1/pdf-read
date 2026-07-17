import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, message } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { useReaderStore } from '../../stores/readerStore';
import { getStoredApiKey } from '../common/ApiKeyModal';

interface ToolbarPosition {
  top: number;
  left: number;
}

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
}

export default function SentenceAnalyzer({ containerRef }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const selectedTextRef = useRef<string>('');
  const { selectedSentence, analyzingSentence, setSelectedSentenceText } = useReaderStore();

  const hideToolbar = useCallback(() => {
    setVisible(false);
    selectedTextRef.current = '';
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      // Debounce: skip if clicking on the toolbar itself
      const target = e.target as HTMLElement;
      if (target.closest('.sentence-analyzer-toolbar')) return;

      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          hideToolbar();
          return;
        }

        const text = selection.toString().trim();
        if (text.length < 10 || text.length > 500) {
          hideToolbar();
          return;
        }

        // Valid selection — show toolbar near the selection end
        selectedTextRef.current = text;

        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();

          const toolbarWidth = 130;
          const toolbarHeight = 40;
          const gap = 8;

          let top = rect.bottom + gap;
          let left = (rect.left + rect.right) / 2 - toolbarWidth / 2;

          // Clamp to viewport
          if (top + toolbarHeight > window.innerHeight - 10) {
            top = rect.top - toolbarHeight - gap;
          }
          if (left < 10) left = 10;
          if (left + toolbarWidth > window.innerWidth - 10) {
            left = window.innerWidth - toolbarWidth - 10;
          }

          setPosition({ top, left });
          setVisible(true);
        } catch {
          hideToolbar();
        }
      }, 100);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sentence-analyzer-toolbar')) {
        hideToolbar();
      }
    };

    const handleScroll = () => hideToolbar();
    const handleResize = () => hideToolbar();

    container.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [containerRef, hideToolbar]);

  const handleAnalyze = useCallback(() => {
    const text = selectedTextRef.current;
    if (!text) return;

    const apiKey = getStoredApiKey();
    if (!apiKey) {
      message.warning('请先在首页配置 DeepSeek API Key');
      hideToolbar();
      return;
    }

    if (analyzingSentence) {
      message.info('当前有句子正在分析中，请稍候...');
      hideToolbar();
      return;
    }

    // Find the paragraph context
    const selection = window.getSelection();
    let paraIndex: number | null = null;
    let context = '';

    if (selection && selection.anchorNode) {
      const anchor = selection.anchorNode;
      const el = anchor.nodeType === Node.TEXT_NODE
        ? (anchor as Text).parentElement
        : (anchor as Element);
      if (el) {
        const paraBlock = el.closest('[data-para-index]');
        if (paraBlock) {
          paraIndex = parseInt(paraBlock.getAttribute('data-para-index') || '', 10);
          // Try to get paragraph text from the DOM
          const textEl = paraBlock.querySelector('.paragraph-text');
          if (textEl) {
            context = textEl.textContent || '';
          }
        }
      }
    }

    setSelectedSentenceText(text, context);
    hideToolbar();
    window.getSelection()?.removeAllRanges();
  }, [analyzingSentence, setSelectedSentenceText, hideToolbar]);

  if (!visible) return null;

  return createPortal(
    <div
      className="sentence-analyzer-toolbar fixed z-[9999] shadow-lg rounded-lg bg-white border border-gray-200 px-3 py-2"
      style={{ top: position.top, left: position.left }}
    >
      <Button
        type="primary"
        size="small"
        icon={<BulbOutlined />}
        onClick={handleAnalyze}
        loading={analyzingSentence}
      >
        分析句子
      </Button>
    </div>,
    document.body
  );
}
