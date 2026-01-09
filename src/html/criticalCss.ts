import path from 'node:path';
import type { CheerioAPI } from 'cheerio';
import { EXTENSIONS } from '../core/constants.js';
import { pathExists, readFile, stat } from '../utils/fs.js';
import { resolvePageAssetUrl } from '../utils/pagePaths.js';

const INLINE_THRESHOLD_BYTES = 6 * 1024;
const APP_SHELL_CRITICAL_CSS = `
@layer tokens {
    :root {
        --ws-header-control-size: 2.6rem;
        --ws-header-block-padding: 0.75rem;
        --ws-header-sticky-offset: calc(
            var(--ws-header-control-size) + (var(--ws-header-block-padding) * 2) + 1px
        );
        --ws-font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
            Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif;
    }
}

@layer reset {
    *,
    *::before,
    *::after {
        box-sizing: border-box;
    }
}

@layer base {
    html,
    body {
        height: 100%;
    }

    body {
        margin: 0;
        font-family: var(--ws-font-sans);
        font-size: 16px;
        line-height: 1.6;
        padding-top: var(--ws-header-sticky-offset, 0px);
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
        line-height: 1.25;
        margin: 0 0 0.5rem 0;
    }

    h1 {
        font-size: clamp(2rem, 4vw, 2.75rem);
        letter-spacing: -0.02em;
    }

    h2 {
        font-size: clamp(1.5rem, 2.5vw, 2rem);
        letter-spacing: -0.01em;
    }

    h3 {
        font-size: 1.35rem;
    }

    p {
        margin: 0 0 1rem 0;
    }
}

@layer components {
    .app-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: calc(var(--ws-header-sticky-offset) - 1px);
    }
}
`.trim();
const DOCS_SHELL_CRITICAL_CSS = `
@layer overrides {
    .docs-layout {
        --ws-docs-sidebar-width: clamp(14rem, 20vw, 18rem);
        --ws-docs-layout-padding: 48px 0 96px;
        --ws-container: 100%;
        padding: var(--ws-docs-layout-padding);
        padding-top: 0;
    }

    .docs-layout__inner {
        display: grid;
        grid-template-columns: var(--ws-docs-sidebar-width, 16rem) minmax(0, 1fr);
        gap: var(--ws-space-6, 1.5rem);
        align-items: start;
        padding-inline: 0;
        margin-inline: 0;
        min-height: calc(100vh - var(--ws-header-sticky-offset, 0px));
    }

    .docs-main {
        width: 100%;
        max-width: var(--ws-article, 72ch);
        margin-inline: 0;
        min-width: 0;
        grid-column: 2;
        padding-top: var(--ws-space-5, 1.25rem);
        padding-right: var(--ws-space-6, 1.5rem);
    }

    @media (max-width: 40rem) {
        .docs-layout__inner {
            grid-template-columns: minmax(0, 1fr);
            padding-left: max(var(--ws-container-pad, 1rem), env(safe-area-inset-left));
            padding-right: max(var(--ws-container-pad, 1rem), env(safe-area-inset-right));
        }

        .docs-main {
            max-width: none;
            justify-self: stretch;
            grid-column: auto;
            padding-top: var(--ws-space-4, 1rem);
            padding-right: 0;
        }
    }
}
`.trim();

export async function inlineCriticalCss(
    document: CheerioAPI,
    pageName: string,
    pagesRoot: string,
    pagesUrlPrefix: string,
    cssFile?: string
): Promise<void> {
    if (!cssFile) {
        return;
    }

    const cssPath = path.join(pagesRoot, pageName, cssFile);
    if (!(await pathExists(cssPath))) {
        return;
    }

    const info = await stat(cssPath).catch(() => null);
    if (!info || !info.isFile() || info.size > INLINE_THRESHOLD_BYTES) {
        return;
    }

    const cssContent = await readFile(cssPath);
    const head = document('head').first();
    if (head.length === 0) {
        return;
    }

    const href = resolvePageAssetUrl(pagesUrlPrefix, pageName, cssFile);
    document(`link[href="${href}"]`).remove();

    if (cssFile.endsWith(EXTENSIONS.css)) {
        document(`link[rel="preload"][href="${href}"]`).remove();
    }

    head.append(`\n<style data-critical>\n${cssContent}\n</style>\n`);
}

export function ensureAppShellCriticalCss(document: CheerioAPI, appCssHref: string): void {
    const head = document('head').first();
    if (head.length === 0) {
        return;
    }

    const existing = head.find('style[data-critical="app"]').first();
    if (existing.length > 0) {
        return;
    }

    const stylesheet = document(`link[rel="stylesheet"][href="${appCssHref}"]`).first();
    const styleTag = `<style data-critical="app">\n${APP_SHELL_CRITICAL_CSS}\n</style>`;
    if (stylesheet.length > 0) {
        stylesheet.before(styleTag);
    } else {
        head.append(styleTag);
    }
}

export function ensureDocsShellCriticalCss(document: CheerioAPI): void {
    const head = document('head').first();
    if (head.length === 0) {
        return;
    }

    const existing = head.find('style[data-critical="docs"]').first();
    if (existing.length > 0) {
        return;
    }

    const docsStylesheet = document('link[rel="stylesheet"]').filter((_, element) => {
        const href = document(element).attr('href');
        return typeof href === 'string' && href.includes('/docs/');
    }).first();

    const styleTag = `<style data-critical="docs">\n${DOCS_SHELL_CRITICAL_CSS}\n</style>`;
    if (docsStylesheet.length > 0) {
        docsStylesheet.before(styleTag);
    } else {
        head.append(styleTag);
    }
}
