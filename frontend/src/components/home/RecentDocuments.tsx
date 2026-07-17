import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Typography, Tag, Space, Empty, Spin } from 'antd';
import { FilePdfOutlined, RightOutlined } from '@ant-design/icons';
import { listDocuments, type DocumentListItem } from '../../services/pdfApi';
import dayjs from 'dayjs';

const { Text } = Typography;

const statusColorMap: Record<string, string> = {
  pending: 'default',
  processing: 'processing',
  completed: 'success',
  failed: 'error',
};

const statusLabelMap: Record<string, string> = {
  pending: '等待中',
  processing: '解析中',
  completed: '已完成',
  failed: '失败',
};

export default function RecentDocuments() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDocuments = async () => {
      setLoading(true);
      try {
        const result = await listDocuments(10, 0);
        setDocuments(result.documents);
      } catch {
        // Silently fail for recent documents
      } finally {
        setLoading(false);
      }
    };
    fetchDocuments();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-8">
        <Spin />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <Empty
        description="还没有处理过文档，上传一篇 PDF 开始吧"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <div>
      <Text strong className="text-lg mb-4 block">
        最近处理
      </Text>
      <List
        dataSource={documents}
        renderItem={(doc) => (
          <List.Item
            className="cursor-pointer hover:bg-gray-50 px-4 rounded-lg transition-colors"
            onClick={() => {
              if (doc.parse_status === 'completed') {
                navigate(`/document/${doc.id}`);
              }
            }}
          >
            <List.Item.Meta
              avatar={
                <FilePdfOutlined className="text-2xl text-red-500 mt-1" />
              }
              title={
                <Space>
                  <Text strong>{doc.title || 'Untitled'}</Text>
                  <Tag color={statusColorMap[doc.parse_status] || 'default'}>
                    {statusLabelMap[doc.parse_status] || doc.parse_status}
                  </Tag>
                </Space>
              }
              description={
                <Space size="large">
                  {doc.source && (
                    <Text type="secondary">{doc.source}</Text>
                  )}
                  {doc.word_count && (
                    <Text type="secondary">
                      {doc.word_count.toLocaleString()} 词
                    </Text>
                  )}
                  <Text type="secondary">
                    {dayjs(doc.created_at).format('YYYY-MM-DD HH:mm')}
                  </Text>
                </Space>
              }
            />
            <RightOutlined className="text-gray-400" />
          </List.Item>
        )}
      />
    </div>
  );
}
