import { useNavigate } from 'react-router-dom';
import { Button, Space, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useDocumentStore } from '../../stores/documentStore';

const { Title } = Typography;

export default function DocumentHeader() {
  const navigate = useNavigate();
  const { title, source } = useDocumentStore();

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
      <Space size="large">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/')}
        >
          返回
        </Button>

        <div>
          <Space align="center">
            <Title level={4} className="!mb-0">
              {title || 'Untitled'}
            </Title>
{/* source tag removed */}
          </Space>
        </div>
      </Space>
    </header>
  );
}
