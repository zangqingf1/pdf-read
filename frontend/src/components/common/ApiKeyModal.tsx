import { useState, useEffect } from 'react';
import { Modal, Input, Button, Typography, Alert, Space, Divider } from 'antd';
import { KeyOutlined, CheckCircleOutlined, CloudOutlined, RobotOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const MINERU_KEY = 'mineru_api_token';
const DEEPSEEK_KEY = 'deepseek_api_key';

export function getStoredMineruToken(): string {
  return localStorage.getItem(MINERU_KEY) || '';
}

export function setStoredMineruToken(token: string) {
  localStorage.setItem(MINERU_KEY, token);
}

export function getStoredDeepseekKey(): string {
  return localStorage.getItem(DEEPSEEK_KEY) || '';
}

export function setStoredDeepseekKey(key: string) {
  localStorage.setItem(DEEPSEEK_KEY, key);
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ApiKeyModal({ open, onClose }: Props) {
  const [mineruToken, setMineruToken] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMineruToken(getStoredMineruToken());
    setDeepseekKey(getStoredDeepseekKey());
  }, [open]);

  const handleSave = () => {
    setStoredMineruToken(mineruToken.trim());
    setStoredDeepseekKey(deepseekKey.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <Modal
      title={
        <Space>
          <KeyOutlined />
          <span>API 密钥配置</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={saved ? <CheckCircleOutlined /> : <KeyOutlined />}
            onClick={handleSave}
          >
            {saved ? '已保存' : '保存'}
          </Button>
        </Space>
      }
      width={520}
    >
      <Alert
        message="密钥仅保存在浏览器本地，不会上传到服务器"
        type="info"
        showIcon
        className="mb-4"
      />

      {/* MinerU */}
      <div className="space-y-3">
        <Space>
          <CloudOutlined className="text-blue-500" />
          <Text strong>MinerU API Token</Text>
        </Space>
        <Input.Password
          value={mineruToken}
          onChange={(e) => setMineruToken(e.target.value)}
          placeholder="输入 MinerU API Token"
          size="large"
        />
        <Paragraph type="secondary" className="!text-xs !mt-1 !mb-0">
          前往{' '}
          <a href="https://mineru.net/apiManage" target="_blank" rel="noopener">
            mineru.net
          </a>{' '}
          获取 Token，用于 PDF 高精度识别
        </Paragraph>
      </div>

      <Divider />

      {/* DeepSeek */}
      <div className="space-y-3">
        <Space>
          <RobotOutlined className="text-green-500" />
          <Text strong>DeepSeek API Key</Text>
        </Space>
        <Input.Password
          value={deepseekKey}
          onChange={(e) => setDeepseekKey(e.target.value)}
          placeholder="输入 DeepSeek API Key"
          size="large"
        />
        <Paragraph type="secondary" className="!text-xs !mt-1 !mb-0">
          前往{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">
            platform.deepseek.com
          </a>{' '}
          获取 Key，用于 AI 段落翻译
        </Paragraph>
      </div>
    </Modal>
  );
}
