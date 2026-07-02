import { writeFileSync, renameSync, unlinkSync } from 'node:fs';

/**
 * Write JSON atomically: serialize to a temp file on the same volume, then
 * rename over the target (rename is atomic on a single filesystem). A crash or
 * Ctrl-C mid-write can never leave a half-written file that later reads as
 * "no data". Concurrent writers still last-writer-wins, but neither ever sees a
 * truncated file.
 *
 * pretty:false (default) is for machine-read files that can be large (the
 * metadata cache) — no indentation means ~30-50% fewer bytes and less CPU.
 */
export function writeJsonAtomic(file, obj, { pretty = false } = {}) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw e;
  }
}
