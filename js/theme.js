/**
 * Theme manager: light / dark, persisted in localStorage.
 * First visit follows the OS preference. The <head> inline script in
 * index.html applies the theme before first paint so there is no flash.
 */
const KEY = 'pulseorbit-theme';
const root = document.documentElement;
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch (_) {
    return null;
  }
}

export function currentTheme() {
  return root.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme, animate) {
  if (animate) {
    root.classList.add('theme-anim');
    clearTimeout(apply.t);
    apply.t = setTimeout(() => root.classList.remove('theme-anim'), 450);
  }
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#060a16' : '#f4f7fc';
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function initTheme(button) {
  const stored = readStored();
  const initial = stored || (mq && mq.matches ? 'dark' : 'light');
  apply(initial, false);

  const sync = () => {
    const t = currentTheme();
    button.setAttribute('aria-pressed', String(t === 'dark'));
    button.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    button.title = button.getAttribute('aria-label');
  };
  sync();

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {
      /* storage unavailable: theme still changes for this visit */
    }
    apply(next, true);
    sync();
  });

  // Follow OS changes only while the user has not chosen explicitly.
  if (mq) {
    const onChange = (e) => {
      if (readStored()) return;
      apply(e.matches ? 'dark' : 'light', true);
      sync();
    };
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  }
}
