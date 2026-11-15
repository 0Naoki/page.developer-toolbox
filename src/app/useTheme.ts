import { useLayoutEffect } from 'react';
import { usePreference } from '../hooks/usePreference';
import { oneOf } from '../lib/settings';

export type Theme = 'system' | 'light' | 'dark';
const isTheme = oneOf<Theme>('system', 'light', 'dark');

/** 保存されたテーマを描画前に反映する。 */
export function useTheme() {
  const [theme, setTheme] = usePreference<Theme>('theme', 'system', isTheme, true);
  /** 描画の前に反映し、選んだ色と逆の色の画面が見えないようにする */
  useLayoutEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  return [theme, setTheme] as const;
}
