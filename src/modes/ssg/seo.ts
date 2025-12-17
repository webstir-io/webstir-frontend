import path from 'node:path';
import { glob } from 'glob';
import { load } from 'cheerio';
import { ensureDir, pathExists, readFile, writeFile } from '../../utils/fs.js';
import { FILES } from '../../core/constants.js';

interface HtmlPage {
    readonly filePath: string;
    readonly urlPath: string;
}

export interface SsgSeoOptions {
    readonly siteUrl?: string;
}

export async function runSsgSeo(distRoot: string, options: SsgSeoOptions = {}): Promise<void> {
    const pages = await discoverHtmlPages(distRoot);
    await validateInternalLinks(pages, distRoot);
    await writeSitemap(distRoot, pages, options.siteUrl);
    await writeRobots(distRoot, options.siteUrl);
}

async function discoverHtmlPages(distRoot: string): Promise<HtmlPage[]> {
    if (!(await pathExists(distRoot))) {
        return [];
    }

    const files = await glob('**/index.html', { cwd: distRoot, nodir: true, ignore: ['pages/**'] });
    const pages = files
        .map((relative) => {
            const normalized = relative.split(path.sep).join('/');
            const urlPath = toUrlPath(normalized);
            return {
                filePath: path.join(distRoot, relative),
                urlPath
            };
        })
        .filter((page) => Boolean(page.urlPath));

    pages.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
    return pages;
}

function toUrlPath(relativeIndex: string): string {
    if (relativeIndex === FILES.indexHtml) {
        return '/';
    }

    if (relativeIndex.endsWith(`/${FILES.indexHtml}`)) {
        return `/${relativeIndex.slice(0, -FILES.indexHtml.length)}`;
    }

    return '';
}

async function validateInternalLinks(pages: readonly HtmlPage[], distRoot: string): Promise<void> {
    if (pages.length === 0) {
        return;
    }

    const knownPages = new Set<string>(pages.map((page) => page.urlPath));
    const idsByPath = await collectIdsByPath(pages);
    const errors: string[] = [];

    for (const page of pages) {
        const html = await readFile(page.filePath);
        const doc = load(html);
        const anchors = doc('a[href]').toArray();

        for (const element of anchors) {
            const rawHref = doc(element).attr('href')?.trim() ?? '';
            if (!rawHref) {
                continue;
            }

            if (isExternalHref(rawHref)) {
                continue;
            }

            const resolved = resolveHref(page.urlPath, rawHref);
            if (!resolved) {
                continue;
            }

            const normalizedPath = normalizePagePath(resolved.pathname, knownPages);
            if (!normalizedPath) {
                // Still allow links to known static assets (best-effort).
                if (await targetExistsInDist(distRoot, resolved.pathname)) {
                    continue;
                }

                errors.push(`${page.filePath}: broken link '${rawHref}'`);
                continue;
            }

            const hash = resolved.hash.startsWith('#') ? resolved.hash.slice(1) : resolved.hash;
            if (!hash) {
                continue;
            }

            const ids = idsByPath.get(normalizedPath) ?? new Set<string>();
            if (!ids.has(hash)) {
                errors.push(`${page.filePath}: broken anchor '${rawHref}' (missing '#${hash}' on ${normalizedPath})`);
            }
        }
    }

    if (errors.length === 0) {
        return;
    }

    const preview = errors.slice(0, 16).join('\n');
    const suffix = errors.length > 16 ? `\n… and ${errors.length - 16} more.` : '';
    throw new Error(`Broken links found in publish output:\n${preview}${suffix}`);
}

async function collectIdsByPath(pages: readonly HtmlPage[]): Promise<Map<string, Set<string>>> {
    const idsByPath = new Map<string, Set<string>>();

    for (const page of pages) {
        const html = await readFile(page.filePath);
        const doc = load(html);
        const ids = new Set<string>();

        doc('[id]').each((_, element) => {
            const raw = doc(element).attr('id');
            const value = typeof raw === 'string' ? raw.trim() : '';
            if (value) {
                ids.add(value);
            }
        });

        idsByPath.set(page.urlPath, ids);
    }

    return idsByPath;
}

function isExternalHref(href: string): boolean {
    if (href.startsWith('//')) {
        return true;
    }
    return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function resolveHref(basePath: string, href: string): URL | null {
    try {
        const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
        return new URL(href, `http://webstir.local${base}`);
    } catch {
        return null;
    }
}

function normalizePagePath(pathname: string, knownPages: ReadonlySet<string>): string | null {
    if (pathname === '/' || pathname === '') {
        return '/';
    }

    if (pathname.endsWith('/index.html')) {
        const asDir = pathname.slice(0, -'index.html'.length);
        return knownPages.has(asDir) ? asDir : null;
    }

    if (pathname.endsWith('.html')) {
        return knownPages.has(pathname) ? pathname : null;
    }

    if (pathname.endsWith('/')) {
        return knownPages.has(pathname) ? pathname : null;
    }

    const withSlash = `${pathname}/`;
    if (knownPages.has(withSlash)) {
        return withSlash;
    }

    return knownPages.has(pathname) ? pathname : null;
}

async function targetExistsInDist(distRoot: string, pathname: string): Promise<boolean> {
    if (!pathname.startsWith('/')) {
        return false;
    }

    const relative = pathname.replace(/^\/+/, '');
    if (!relative) {
        return true;
    }

    const full = path.join(distRoot, relative);
    if (await pathExists(full)) {
        return true;
    }

    const asIndex = path.join(distRoot, relative, FILES.indexHtml);
    return pathExists(asIndex);
}

async function writeSitemap(distRoot: string, pages: readonly HtmlPage[], siteUrl?: string): Promise<void> {
    const urls = pages.map((page) => page.urlPath).filter((url) => url.startsWith('/'));
    const unique = Array.from(new Set(urls)).sort((a, b) => a.localeCompare(b));

    const baseUrl = normalizeSiteUrl(siteUrl);
    const comment = baseUrl ? '' : '<!-- Set WEBSTIR_SITE_URL to emit absolute <loc> entries. -->\n';

    const entries = unique
        .map((pathname) => {
            const loc = baseUrl ? new URL(pathname, baseUrl).href : pathname;
            return `  <url><loc>${escapeXml(loc)}</loc></url>`;
        })
        .join('\n');

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        comment + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        entries,
        '</urlset>',
        ''
    ].join('\n');

    const outputPath = path.join(distRoot, 'sitemap.xml');
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, xml);
}

async function writeRobots(distRoot: string, siteUrl?: string): Promise<void> {
    const baseUrl = normalizeSiteUrl(siteUrl);
    const sitemapLine = baseUrl ? `\nSitemap: ${new URL('/sitemap.xml', baseUrl).href}` : '';
    const content = `User-agent: *\nAllow: /${sitemapLine}\n`;

    const outputPath = path.join(distRoot, FILES.robotsTxt);
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, content);
}

function normalizeSiteUrl(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const url = new URL(trimmed);
        url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
        url.hash = '';
        url.search = '';
        return url.toString();
    } catch {
        return undefined;
    }
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
