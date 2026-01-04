import type { CheerioAPI } from 'cheerio';
import { resolvePageHtmlUrl } from '../utils/pagePaths.js';

export interface ResourceHintResult {
    readonly added: number;
    readonly candidates: string[];
    readonly missingHead: boolean;
}

export function injectResourceHints(
    document: CheerioAPI,
    currentPage: string,
    pagesUrlPrefix: string,
    useRootIndex: boolean
): ResourceHintResult {
    const head = document('head').first();
    const pages = [...collectInternalPages(document, currentPage, pagesUrlPrefix)];

    if (head.length === 0) {
        return {
            added: 0,
            candidates: pages,
            missingHead: pages.length > 0
        };
    }

    if (pages.length === 0) {
        return { added: 0, candidates: [], missingHead: false };
    }

    for (const page of pages) {
        const href = resolvePageHtmlUrl(pagesUrlPrefix, page, useRootIndex);
        head.append(`\n<link rel="prefetch" href="${href}" as="document">`);
    }

    return { added: pages.length, candidates: pages, missingHead: false };
}

function collectInternalPages(document: CheerioAPI, currentPage: string, pagesUrlPrefix: string): Set<string> {
    const pages = new Set<string>();
    document('a[href]').each((_index, element) => {
        const href = document(element).attr('href');
        const pageName = normalizePageName(href, pagesUrlPrefix);
        if (!pageName || pageName === currentPage) {
            return;
        }
        pages.add(pageName);
    });
    return pages;
}

function normalizePageName(href: string | undefined, pagesUrlPrefix: string): string | null {
    if (!href || href.length === 0) {
        return null;
    }

    const lower = href.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:') || lower.startsWith('#')) {
        return null;
    }

    let path = href.split('#')[0]?.split('?')[0] ?? '';
    if (path.length === 0) {
        return null;
    }

    if (path.startsWith('/')) {
        path = path.slice(1);
    }

    const prefix = trimSlashes(pagesUrlPrefix);
    if (prefix && path.startsWith(`${prefix}/`)) {
        path = path.slice(prefix.length + 1);
    }

    if (path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    const segments = path.split('/');
    const candidate = segments[0];
    if (!candidate) {
        return null;
    }

    return candidate;
}

function trimSlashes(value: string): string {
    return value.replace(/^\/+|\/+$/g, '');
}
