import path from 'node:path';
import { ensureDir, pathExists, copy } from '../utils/fs.js';
import { FILES, EXTENSIONS } from '../core/constants.js';
import type { EnableFlags, FrontendConfig } from '../types.js';

export async function resolveEntryPoint(pageDirectory: string): Promise<string | null> {
    const candidates = [`${FILES.index}${EXTENSIONS.ts}`, `${FILES.index}.tsx`, `${FILES.index}${EXTENSIONS.js}`, `${FILES.index}.jsx`];

    for (const candidate of candidates) {
        const file = path.join(pageDirectory, candidate);
        if (await pathExists(file)) {
            return file;
        }
    }

    return null;
}

export async function copyRefreshScript(config: FrontendConfig, enable?: EnableFlags): Promise<void> {
    const runtimeScripts: string[] = [FILES.refreshJs, FILES.hmrJs];
    // Keep any opt-in helper scripts present in the dev build output.
    // These are served from the frontend build root (e.g. /clientNav.js).
    // Watch mode should behave the same as the build pipeline.
    if (enable?.clientNav === true) {
        runtimeScripts.push('clientNav.js');
    }

    for (const scriptName of runtimeScripts) {
        const source = path.join(config.paths.src.app, scriptName);
        if (!(await pathExists(source))) {
            continue;
        }

        const destination = path.join(config.paths.build.frontend, scriptName);
        await ensureDir(path.dirname(destination));
        await copy(source, destination);
    }
}
