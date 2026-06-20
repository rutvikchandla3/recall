export const RESULT_ROW_HEIGHT = 3;
export const PANE_CHROME_HEIGHT = 4;

export interface ResultWindow {
  start: number;
  end: number;
}

export interface LayoutOptions {
  rows: number;
  helpOpen: boolean;
  hasWarnings: boolean;
}

export function computeVisibleResultCount(options: LayoutOptions): number {
  const safeRows = Number.isFinite(options.rows) && options.rows > 0 ? Math.floor(options.rows) : 24;
  const reservedRows = 14 + (options.helpOpen ? 6 : 0) + (options.hasWarnings ? 2 : 0);
  const available = Math.max(7, safeRows - reservedRows);

  return clamp(Math.floor((available - 1) / RESULT_ROW_HEIGHT), 2, 10);
}

export function computeResultWindow(total: number, selectedIndex: number, visibleCount: number): ResultWindow {
  if (total <= 0 || visibleCount <= 0) {
    return { start: 0, end: 0 };
  }

  if (total <= visibleCount) {
    return { start: 0, end: total };
  }

  const half = Math.floor(visibleCount / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = start + visibleCount;

  if (end > total) {
    end = total;
    start = Math.max(0, end - visibleCount);
  }

  return { start, end };
}

export function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength === 1) {
    return '…';
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
