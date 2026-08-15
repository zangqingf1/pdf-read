/** ESLint 配置（legacy .eslintrc 格式，兼容 ESLint 8 + typescript-eslint 7）。 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'export_preview_shots/',
    '*.log',
    '*.tsbuildinfo',
    '*.bundle.js',
    '*.bundle.mjs',
    'vite.config.js',
    'vite.config.d.ts',
    'bench_store.mjs',
    'debug_bundle.js',
    'dom_dump.txt',
    'e2e_dump.txt',
    'export_e2e.cjs',
    'export_probe*',
    'export_render_probe*',
    'paginate_align_test*',
    'paginate_assert*',
    'pdfreader.db',
    'repro*',
    'run_debug*.cjs',
    'spacing_sample.json',
  ],
  rules: {
    // 项目中大量业务代码使用 any 处理外部响应，保持灵活。
    '@typescript-eslint/no-explicit-any': 'off',
    // SSE 读取循环用 while (true) + break 是常见写法，允许循环内常量条件。
    'no-constant-condition': ['error', { checkLoops: false }],
    // 存量组件存在大量依赖数组不完整的历史代码；直接启用会把 lint 变成
    // 大规模行为改动。先关闭，后续按组件逐文件收敛再打开。
    'react-hooks/exhaustive-deps': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
  },
};
