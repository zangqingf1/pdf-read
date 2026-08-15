import { getStoredDeepseekKey } from './ApiKeyModal';
import type { AIProvider } from '../../services/translateApi';

interface ProviderOption {
  value: AIProvider;
  label: string;
  shortLabel: string;
}

const PROVIDERS: ProviderOption[] = [
  { value: 'deepseek', label: 'DeepSeek', shortLabel: 'DS' },
];

interface Props {
  value: AIProvider;
  onChange: (provider: AIProvider) => void;
}

export function hasProviderKey(_provider: AIProvider): boolean {
  return !!getStoredDeepseekKey();
}

export default function ProviderSelector({ value, onChange }: Props) {
  return (
    <div
      className="inline-flex rounded-md border border-hairline overflow-hidden"
      role="radiogroup"
      aria-label="AI 供应商"
    >
      {PROVIDERS.map((p) => {
        const hasKey = hasProviderKey(p.value);
        const isActive = value === p.value;

        return (
          <button
            key={p.value}
            role="radio"
            aria-checked={isActive}
            disabled={!hasKey}
            title={
              !hasKey
                ? `未配置 ${p.label} API Key，请点击右上角🔑图标设置`
                : `使用 ${p.label} API`
            }
            onClick={() => hasKey && onChange(p.value)}
            className={[
              'px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              'first:border-r last:border-l-0 border-hairline',
              'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px]',
              isActive
                ? 'bg-primary text-on-primary border-primary'
                : hasKey
                  ? 'bg-canvas text-ink hover:bg-surface-card active:bg-surface-cream-strong'
                  : 'bg-canvas-soft text-muted-soft cursor-not-allowed',
            ].join(' ')}
          >
            <span className="hidden sm:inline">{p.label}</span>
            <span className="sm:hidden">{p.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
