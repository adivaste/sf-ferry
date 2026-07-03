import { existsSync, readFileSync } from 'node:fs';
import { configFile } from './paths.js';

// Optional ~/.ferry/config.json for defaults, e.g.
// { "apiVersion": "62.0", "defaultTestLevel": "RunLocalTests" }
export function loadConfig() {
    const f = configFile();
    if (!existsSync(f)) return {};
    try {
        return JSON.parse(readFileSync(f, 'utf8')) || {};
    } catch {
        return {};
    }
}
