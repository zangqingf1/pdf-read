import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, message, Progress, Typography, Space, Button, Result } from 'antd';
import { InboxOutlined, FilePdfOutlined, ReadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { uploadPDF, getPDFStatus } from '../../services/pdfApi';
import { getStoredMineruToken } from '../common/ApiKeyModal';

const { Dragger } = Upload;
const { Text } = Typography;

export default function PDFUploader() {
  const [uploading, setUploading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStatus, setParseStatus] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('');
  const navigate = useNavigate();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for parsing status
  useEffect(() => {
    if (!taskId) return;

    const poll = async () => {
      try {
        const result = await getPDFStatus(taskId);
        setParseStatus(result.status);

        if (result.status === 'completed') {
          setParseProgress(100);
          setUploading(false);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (result.status === 'failed') {
          message.error(result.error || 'PDF 解析失败，请检查文件格式');
          setUploading(false);
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setParseProgress((prev) => Math.min(prev + 5, 90));
        }
      } catch {
        // ignore polling errors
      }
    };

    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [taskId]);

  const handleUpload: UploadProps['customRequest'] = useCallback(
    async (options: any) => {
      const { file, onSuccess, onError } = options;

      setUploading(true);
      setParseProgress(0);
      setParseStatus('uploading');
      setDocTitle((file as File).name.replace(/\.pdf$/i, ''));

      try {
        const result = await uploadPDF(file as File, getStoredMineruToken() || undefined);
        setTaskId(result.task_id);
        setParseStatus('processing');
        onSuccess?.(result, file);
      } catch (err: any) {
        const errorMsg = err?.response?.data?.detail || '上传失败，请重试';
        message.error(errorMsg);
        setUploading(false);
        onError?.(err);
      }
    },
    []
  );

  const handleReset = () => {
    setUploading(false);
    setTaskId(null);
    setParseProgress(0);
    setParseStatus('');
    setDocTitle('');
  };

  // Completed state — show success with view button
  if (!uploading && parseStatus === 'completed' && taskId) {
    return (
      <div className="w-full">
        <Result
          status="success"
          title="PDF 解析完成！"
          subTitle={
            <span>
              文档 <Text strong>{docTitle}</Text> 已准备就绪，可以开始精读
            </span>
          }
          extra={[
            <Button
              key="view"
              type="primary"
              size="large"
              icon={<ReadOutlined />}
              onClick={() => navigate(`/document/${taskId}`)}
            >
              开始阅读
            </Button>,
            <Button key="another" onClick={handleReset}>
              上传其他文档
            </Button>,
          ]}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <Dragger
        name="file"
        multiple={false}
        accept=".pdf"
        disabled={uploading}
        customRequest={handleUpload}
        showUploadList={false}
        className="!rounded-xl !border-2 !border-dashed !border-blue-300 hover:!border-blue-500 !bg-blue-50/50 !p-8"
      >
        <p className="text-5xl text-blue-400 mb-4">
          <InboxOutlined />
        </p>
        <p className="text-lg text-gray-700 mb-2">
          点击或拖拽 PDF 文件到此区域上传
        </p>
        <p className="text-sm text-gray-400">
          支持经济学人、时代周刊等外刊 PDF，最大 50MB
        </p>
      </Dragger>

      {uploading && (
        <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
          <Space direction="vertical" className="w-full">
            <Space>
              <FilePdfOutlined className="text-red-500" />
              <Text strong>
                {parseStatus === 'uploading'
                  ? '正在上传文件...'
                  : parseStatus === 'processing'
                  ? '正在解析 PDF 正文...'
                  : '处理中...'}
              </Text>
            </Space>
            <Progress
              percent={parseProgress}
              status={
                parseStatus === 'failed'
                  ? 'exception'
                  : parseStatus === 'completed'
                  ? 'success'
                  : 'active'
              }
              strokeColor="#2563eb"
            />
            <Text type="secondary" className="text-xs">
              {parseStatus === 'uploading' && '上传中...'}
              {parseStatus === 'processing' &&
                '正在进行版面分析，提取正文内容，过滤页眉页脚和广告...'}
            </Text>
          </Space>
        </div>
      )}
    </div>
  );
}
