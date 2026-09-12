/** 首次访问标记 — 决定未登录用户打开 `/` 时进欢迎页还是登录页 */

const LANDING_VISITED_KEY = 'landing_visited';

export function hasVisitedLanding(): boolean {
  try {
    return localStorage.getItem(LANDING_VISITED_KEY) === '1';
  } catch {
    // 隐私模式下 localStorage 可能不可读：当作首次访问，保证欢迎页仍可见
    return false;
  }
}

export function markLandingVisited(): void {
  try {
    localStorage.setItem(LANDING_VISITED_KEY, '1');
  } catch {
    // 写入失败则退化为每次都是首次访问，不影响功能
  }
}
