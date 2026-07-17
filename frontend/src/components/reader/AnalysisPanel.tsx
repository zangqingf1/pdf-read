import { useState, useEffect, useRef } from 'react';
import { Tabs } from 'antd';
import WordExplainPanel from './WordExplainPanel';
import SentenceAnalysisPanel from './SentenceAnalysisPanel';
import { useReaderStore } from '../../stores/readerStore';

export default function AnalysisPanel() {
  const { selectedSentence } = useReaderStore();
  const [activeKey, setActiveKey] = useState<string>('word');
  const prevSentenceRef = useRef<string>('');

  // Auto-switch to sentence tab when a sentence is selected
  useEffect(() => {
    if (selectedSentence && selectedSentence !== prevSentenceRef.current) {
      setActiveKey('sentence');
    }
    prevSentenceRef.current = selectedSentence;
  }, [selectedSentence]);

  const handleTabChange = (key: string) => {
    setActiveKey(key);
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs
        activeKey={activeKey}
        onChange={handleTabChange}
        items={[
          {
            key: 'word',
            label: '单词解析',
            children: (
              <div className="h-[calc(100vh-180px)] overflow-hidden">
                <WordExplainPanel />
              </div>
            ),
          },
          {
            key: 'sentence',
            label: '句子分析',
            children: (
              <div className="h-[calc(100vh-180px)] overflow-hidden">
                <SentenceAnalysisPanel />
              </div>
            ),
          },
        ]}
        className="h-full [&_.ant-tabs-content]:h-full"
        tabBarStyle={{ paddingLeft: 16, paddingRight: 16, marginBottom: 0 }}
      />
    </div>
  );
}
