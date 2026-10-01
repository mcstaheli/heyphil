// The last few JavaScript errors on this page, attached to each Improvements
// report (SnapshotReporter) so triage can see what went wrong before the
// reporter pressed 📸. Fed by window 'error', 'unhandledrejection' and a
// console.error wrapper (which still calls the original). Installed once at
// startup (index.js).

const MAX = 20;
const buffer = [];
let installed = false;

const text = (v) => {
  if (v instanceof Error) return v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};

export function recordError(source, message, stack) {
  buffer.push({
    source,
    message: String(message || '').slice(0, 500),
    stack: stack ? String(stack).slice(0, 500) : null,
    time: new Date().toISOString(),
  });
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
}

export function getRecentErrors() {
  return buffer.slice();
}

export function clearRecentErrors() {
  buffer.length = 0;
}

export function installErrorBuffer(win = window) {
  if (installed) return;
  installed = true;
  win.addEventListener('error', (e) => {
    recordError('window.error', e.message || text(e.error), e.error && e.error.stack);
  });
  win.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    recordError('unhandledrejection', text(r), r && r.stack);
  });
  const original = win.console.error.bind(win.console);
  win.console.error = (...args) => {
    try {
      const err = args.find((a) => a instanceof Error);
      recordError('console.error', args.map(text).join(' '), err && err.stack);
    } catch (e) {
      // never let the buffer break logging
    }
    original(...args);
  };
}
