import type { Theme } from '../lib/theme.ts';

/**
 * Inline SVG rather than glyphs like ◐ / ☾ / ☀.
 *
 * Those characters render at wildly different optical sizes across platforms
 * and are missing outright from some Android font stacks, which left the button
 * looking like a stray dot. A path is the same everywhere and inherits colour.
 */
export function ThemeToggle({ theme, resolved, onCycle }: {
  theme: Theme;
  resolved: 'light' | 'dark';
  onCycle: () => void;
}) {
  const label = theme === 'system' ? `Theme: match system (${resolved})` : `Theme: ${theme}`;

  return (
    <button
      class="theme-toggle" type="button" onClick={onCycle}
      aria-label={`${label}. Click to change.`} title={label}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="1.7"
           stroke-linecap="round" stroke-linejoin="round">
        {theme === 'system' ? (
          // A circle split down the middle: neither light nor dark, follow the OS.
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4v16" />
            <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
          </>
        ) : theme === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
          </>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
        )}
      </svg>
    </button>
  );
}
