import { useDocumentStore } from '../../stores/documentStore';
import ParagraphBlock from './ParagraphBlock';
import { Typography, Tag, Space } from 'antd';
import { FileTextOutlined, CalculatorOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function ArticleView() {
  const { title, source, paragraphs, wordCount, paragraphCount, translations } =
    useDocumentStore();

  return (
    <div>
      <div className="mb-8 pb-6 border-b border-gray-200">
        <Title level={2} className="!mb-2">
          {title || 'Untitled Document'}
        </Title>
        <Space size="middle" className="flex-wrap">
          {source && <Tag color="blue">{source}</Tag>}
          <Text type="secondary">
            <FileTextOutlined className="mr-1" />
            {paragraphCount || paragraphs.length} 段落
          </Text>
          <Text type="secondary">
            <CalculatorOutlined className="mr-1" />
            {wordCount?.toLocaleString() || '—'} 词
          </Text>
        </Space>
      </div>

      <div className="space-y-6">
        {paragraphs.map((para, idx) => (
          <ParagraphBlock
            key={idx}
            paragraph={para}
            translation={translations[para.index]}
          />
        ))}
      </div>
    </div>
  );
}
