import { useState, useEffect } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';

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
      open={open}
      onClose={onClose}
      title="API 密钥配置"
      width="520px"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saved} onClick={handleSave}>
            {saved ? '已保存' : '保存'}
          </Button>
        </>
      }
    >
      <div className="mb-4 p-3 bg-canvas-soft border border-hairline rounded-md text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          密钥仅保存在浏览器本地，不会上传到服务器
        </span>
      </div>

      {/* MinerU */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
            <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
          </svg>
          <span className="text-sm font-medium text-body-strong">MinerU API Token</span>
        </div>
        <Input
          type="password"
          value={mineruToken}
          onChange={(e) => setMineruToken(e.target.value)}
          placeholder="输入 MinerU API Token"
        />
        <p className="text-xs text-muted-soft mt-1.5">
          前往{' '}
          <a href="https://mineru.net/apiManage" target="_blank" rel="noopener" className="text-primary hover:text-primary-active underline">
            mineru.net
          </a>{' '}
          获取 Token，用于 PDF 高精度识别
        </p>
      </div>

      <div className="border-t border-hairline-soft my-4" />

      {/* DeepSeek */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-teal)" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <circle cx="15.5" cy="8.5" r="1.5" />
            <path d="M8 14s2 3 4 3 4-3 4-3" />
          </svg>
          <span className="text-sm font-medium text-body-strong">DeepSeek API Key</span>
        </div>
        <Input
          type="password"
          value={deepseekKey}
          onChange={(e) => setDeepseekKey(e.target.value)}
          placeholder="输入 DeepSeek API Key"
        />
        <p className="text-xs text-muted-soft mt-1.5">
          前往{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener" className="text-primary hover:text-primary-active underline">
            platform.deepseek.com
          </a>{' '}
          获取 Key，用于 AI 段落翻译
        </p>
      </div>
    </Modal>
  );
}
