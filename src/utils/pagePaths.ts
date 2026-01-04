import path from 'node:path';
import { FOLDERS, FILES } from '../core/constants.js';

export function resolvePagesUrlPrefix(frontendRoot: string, pagesRoot: string): string {
    const relative = path.relative(frontendRoot, pagesRoot).replace(/\\/g, '/');
    if (!relative || relative === '.' || relative.startsWith('..')) {
        return '';
    }
    return `/${trimSlashes(relative)}`;
}

export function isRootPagesLayout(frontendRoot: string, pagesRoot: string): boolean {
    return resolvePagesUrlPrefix(frontendRoot, pagesRoot) === '';
}

export function resolvePageAssetUrl(pagesUrlPrefix: string, pageName: string, fileName: string): string {
    return joinUrl(pagesUrlPrefix, pageName, fileName);
}

export function resolvePageHtmlUrl(pagesUrlPrefix: string, pageName: string, useRootIndex: boolean): string {
    if (useRootIndex && pageName === FOLDERS.home) {
        return `/${FILES.indexHtml}`;
    }
    return joinUrl(pagesUrlPrefix, pageName, FILES.indexHtml);
}

export function resolvePageHtmlDir(pagesRoot: string, pageName: string, useRootIndex: boolean): string {
    if (useRootIndex && pageName === FOLDERS.home) {
        return pagesRoot;
    }
    return path.join(pagesRoot, pageName);
}

function joinUrl(...segments: string[]): string {
    const cleaned = segments
        .map(segment => trimSlashes(segment))
        .filter(segment => segment.length > 0);
    return `/${cleaned.join('/')}`;
}

function trimSlashes(value: string): string {
    return value.replace(/^\/+|\/+$/g, '');
}
