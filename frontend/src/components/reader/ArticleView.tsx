import { useDocumentStore } from '../../stores/documentStore';
import ParagraphBlock from './ParagraphBlock';
import { Typography, Space, Button, Tooltip } from 'antd';
import {
  FileTextOutlined,
  CalculatorOutlined,
  MinusOutlined,
  PlusOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useReaderStore, FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../stores/readerStore';

const { Title, Text } = Typography;

export default function ArticleView() {
  const {
    title,
    paragraphs,
    wordCount,
    paragraphCount,
    translations,
    isTranslating,
  } = useDocumentStore();
  const { fontSize, increaseFontSize, decreaseFontSize } = useReaderStore();

  const translatedCount = Object.keys(translations).length;
  const total = paragraphCount || paragraphs.length;

  return (
    <div>
      <div className="mb-8 pb-6 border-b border-gray-200">
        <Title level={2} className="!mb-2">
          {title || 'Untitled Document'}
        </Title>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Space size="middle">
            <Text type="secondary">
              <FileTextOutlined className="mr-1" />
              {total} 段落
            </Text>
            <Text type="secondary">
              <CalculatorOutlined className="mr-1" />
              {wordCount?.toLocaleString() || '—'} 词
            </Text>
            {isTranslating && (
              <Text type="secondary">
                <LoadingOutlined className="mr-1" />
                翻译中 ({translatedCount}/{total})
              </Text>
            )}
            {!isTranslating && translatedCount > 0 && translatedCount < total && (
              <Text type="secondary">
                已翻译 {translatedCount}/{total} 段
              </Text>
            )}
          </Space>

          <Space size="small">
            <Tooltip title="缩小字体">
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined />}
                disabled={fontSize <= FONT_SIZE_MIN}
                onClick={decreaseFontSize}
              />
            </Tooltip>
            <Text type="secondary" className="text-xs min-w-[36px] text-center">
              {fontSize}px
            </Text>
            <Tooltip title="放大字体">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                disabled={fontSize >= FONT_SIZE_MAX}
                onClick={increaseFontSize}
              />
            </Tooltip>
          </Space>
        </div>
      </div>

      <div>
        {paragraphs.map((para, idx) => (
          <ParagraphBlock
            key={idx}
            paragraph={para}
            translation={translations[para.index]}
            isTranslating={isTranslating}
          />
        ))}
      </div>
    </div>
  );
}
