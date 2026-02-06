// Lightweight runtime error & promise rejection probe injected before React mounts.
// Purpose: surface early module evaluation errors that would otherwise leave a white screen.
(() => {
  const inject = (label: string, message: string, detail?: string) => {
    try {
      const root = document.getElementById('root') || document.body;
      if (!root) return;
  const banner = document.createElement('div');
  // Prefer theme-driven styles; keep minimal positioning fallbacks so the banner is visible
  // even if the stylesheet is not yet loaded.
  banner.className = 'runtime-error-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'assertive');
  // Minimal positional fallbacks (no colors) to ensure visibility early in page lifecycle
  banner.style.position = 'fixed';
  banner.style.zIndex = '99999';
  banner.style.top = '0';
  banner.style.left = '0';
  banner.style.right = '0';
  banner.innerText = `[${label}] ${message}` + (detail ? `\n${detail}` : '');
      // Only keep the first two to avoid flooding.
      const existing = document.querySelectorAll('.runtime-error-banner');
      if (existing.length >= 2) return;
      root.appendChild(banner);
    } catch {/* ignore */}
  };
  window.addEventListener('error', (e) => {
    if (!e.message) return;
    inject('Error', e.message, e.error && e.error.stack ? e.error.stack.split('\n').slice(0,6).join('\n') : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason;
    const msg = typeof reason === 'string' ? reason : (reason?.message || String(reason));
    inject('PromiseRejection', msg, reason?.stack ? reason.stack.split('\n').slice(0,6).join('\n') : undefined);
  });
})();
