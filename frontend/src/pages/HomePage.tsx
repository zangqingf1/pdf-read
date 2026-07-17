import { useState } from 'react';
import { Layout, Typography, Space, Button } from 'antd';
import { BookOutlined, KeyOutlined } from '@ant-design/icons';
import PDFUploader from '../components/home/PDFUploader';
import RecentDocuments from '../components/home/RecentDocuments';
import ApiKeyModal from '../components/common/ApiKeyModal';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

export default function HomePage() {
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  return (
    <Layout className="min-h-screen">
      <Header className="flex items-center justify-between bg-white shadow-sm px-6">
        <Space>
          <BookOutlined className="text-xl text-blue-600" />
          <Title level={4} className="!mb-0">
            PDF 外刊阅读
          </Title>
        </Space>

        <Button
          type="text"
          icon={<KeyOutlined />}
          onClick={() => setShowApiKeyModal(true)}
        >
          API 配置
        </Button>
      </Header>

      <Content className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero section */}
        <div className="text-center mb-12">
          <Title level={1} className="!mb-4">
            上传 PDF，即刻阅读
          </Title>
          <Text type="secondary" className="text-lg">
            导入英文 PDF，自动提取正文内容，纯净阅读体验
          </Text>
        </div>

        {/* Upload area */}
        <PDFUploader />

        {/* Recent documents */}
        <div className="mt-12">
          <RecentDocuments />
        </div>
      </Content>

      <ApiKeyModal
        open={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </Layout>
  );
}
