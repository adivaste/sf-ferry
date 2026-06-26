// Tiny ANSI helpers for the (non-blessed) deploy/validate phase framing.
const e = (n) => `\x1b[${n}m`;
const R = e(0);
export const c = {
  cyan: (s) => e(36) + s + R,
  green: (s) => e(32) + s + R,
  red: (s) => e(31) + s + R,
  yellow: (s) => e(33) + s + R,
  gray: (s) => e(90) + s + R,
  bold: (s) => e(1) + s + R,
};

// A minimal stderr spinner for the pre-blessed phase (e.g. loading orgs).
// Returns a stop(doneMsg?) function. unref'd so it never holds the process.
export function startSpinner(msg) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const draw = () => process.stderr.write(`\r${c.cyan(frames[i])} ${msg}`);
  draw();
  const t = setInterval(() => { i = (i + 1) % frames.length; draw(); }, 90);
  if (t.unref) t.unref();
  return (doneMsg) => {
    clearInterval(t);
    process.stderr.write('\r\x1b[2K'); // clear the spinner line
    if (doneMsg) process.stderr.write(`${doneMsg}\n`);
  };
}

export function ago(iso) {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const RULE = '─'.repeat(64);

/** Banner printed before a deploy/validate run. */
export function actionBanner({ action, source, target, count, testLevel }) {
  const title = action === 'validate' ? 'VALIDATE' : 'DEPLOY';
  return [
    '',
    `${c.cyan(c.bold(`✷ ${title}`))}  ${c.gray(source)} ${c.gray('→')} ${c.yellow(c.bold(target))}`
      + `   ${c.bold(String(count))} components   ${c.cyan(testLevel)}`,
    c.gray(RULE),
  ].join('\n');
}

export function step(n, total, label) {
  return `  ${c.cyan(`Step ${n}/${total}`)}  ${label}`;
}

/** A colored result box: ok=green ✓, else red ✗. */
export function resultBox({ ok, label }) {
  const txt = `${ok ? '✓' : '✗'} ${label}`;
  const w = txt.length + 2;
  const col = ok ? c.green : c.red;
  return [
    '',
    col(`┌${'─'.repeat(w)}┐`),
    `${col('│')} ${col(c.bold(txt))} ${col('│')}`,
    col(`└${'─'.repeat(w)}┘`),
    '',
  ].join('\n');
}
