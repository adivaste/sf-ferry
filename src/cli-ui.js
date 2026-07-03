// Tiny ANSI helpers for the (non-blessed) deploy/validate phase framing.
// Honour the NO_COLOR convention (https://no-color.org) so piped/CI output stays
// clean — when it's set, every wrapper returns the string untouched.
const e = (n) => `\x1b[${n}m`;
const R = e(0);
const useColor = !process.env.NO_COLOR;
const wrap = (n) => (s) => (useColor ? e(n) + s + R : String(s));
export const c = {
    cyan: wrap(36),
    green: wrap(32),
    red: wrap(31),
    yellow: wrap(33),
    gray: wrap(90),
    bold: wrap(1),
};

// A minimal stderr spinner for the pre-blessed phase (e.g. loading orgs).
// Returns a stop(doneMsg?) function. unref'd so it never holds the process.
const SPINNER_INTERVAL_MS = 90; // frame cadence for the pre-blessed stderr spinner

export function startSpinner(msg) {
    const frames = ['|', '/', '-', '\\']; // ASCII — renders in every terminal/font
    let i = 0;
    const draw = () => process.stderr.write(`\r${c.cyan(frames[i])} ${msg}`);
    draw();
    const t = setInterval(() => {
        i = (i + 1) % frames.length;
        draw();
    }, SPINNER_INTERVAL_MS);
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
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
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
        `${c.cyan(c.bold(`✷ ${title}`))}  ${c.gray(source)} ${c.gray('→')} ${c.yellow(c.bold(target))}` +
            `   ${c.bold(String(count))} components   ${c.cyan(testLevel)}`,
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
