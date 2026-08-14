import { useEffect, useState, useCallback } from 'react';
import { getAdminStats, type AdminStats } from '../../services/adminApi';
import Card from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';

const STAT_CARDS: {
  key: keyof AdminStats;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'total_users',
    label: '用户总数',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'total_documents',
    label: '文档总数',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    key: 'today_users',
    label: '今日新增用户',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    ),
  },
  {
    key: 'today_documents',
    label: '今日新增文档',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
  },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminStats();
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取统计数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" label="加载统计数据..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-error mb-4 text-sm">{error}</p>
        <button
          onClick={fetchStats}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-md font-medium text-sm hover:bg-primary-active transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-display-sm font-display text-ink mb-8">仪表盘</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((card) => (
          <Card key={card.key} className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center">
              {card.icon}
            </div>
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider mb-1">
                {card.label}
              </p>
              <p className="text-2xl font-display text-ink font-semibold tabular-nums">
                {stats?.[card.key] ?? 0}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
