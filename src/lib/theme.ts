import { useEffect, useState } from 'preact/hooks';

/**
 * Theme: system by default, with an explicit override the viewer can set.
 *
 * The choice is written to <html data-theme> so the CSS can key off it, and the
 * theme-color meta is kept in step so the browser chrome and the status bar of
 * an installed PWA match the page instead of flashing the wrong colour.
 */

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'value.theme';
const COLORS: Record<'light' | 'dark', string> = { light: '#FAF8F4', dark: '#0B0D10' };

function read(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', COLORS[resolve(theme)]);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  // While on "system", follow the OS if it changes mid-session.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => apply('system');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [theme]);

  return {
    theme,
    resolved: resolve(theme),
    // Cycles system → light → dark → system, which is fewer taps than a menu
    // for a three-state control.
    cycle: () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'),
  };
}
