/**
 * Theme controller.
 *
 * Themes: light | dark | hacker. The active theme is stored on
 * <html data-theme> and persisted to localStorage. When no preference has
 * been stored the OS colour scheme is followed (light/dark only).
 *
 * A tiny inline script in <head> applies the stored theme before first paint
 * to avoid a flash; this module owns everything after that.
 */

export type Theme = 'light' | 'dark' | 'hacker';

const STORAGE_KEY = 'blinddrop.theme';
const THEMES: readonly Theme[] = ['light', 'dark', 'hacker'];

const THEME_COLOR: Record<Theme, string> = {
  light: '#f4f6fb',
  dark: '#0b1020',
  hacker: '#040806'
};

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return isTheme(attr) ? attr : systemTheme();
}

function paint(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[theme];

  document.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach(button => {
    const pressed = button.dataset.setTheme === theme;
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  });
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the theme still applies for this page load */
  }
  paint(theme);
}

export function initTheme(): void {
  paint(readStoredTheme() ?? systemTheme());

  document.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.setTheme;
      if (isTheme(next)) setTheme(next);
    });
  });

  // Follow the OS while the user has not made an explicit choice.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!readStoredTheme()) paint(systemTheme());
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme, { once: true });
} else {
  initTheme();
}
