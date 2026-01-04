import path from 'node:path';
import { glob } from 'glob';
import { marked } from 'marked';
import { load } from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import hljs from 'highlight.js/lib/common';
import { FOLDERS, FILES, FILE_NAMES, EXTENSIONS } from '../core/constants.js';
import { ensureDir, pathExists, readFile, readJson, remove, writeFile } from '../utils/fs.js';
import type { Builder, BuilderContext } from './types.js';
import { shouldProcess } from '../utils/changedFile.js';
import { getPageDirectories } from '../core/pages.js';
import { readPageManifest, readSharedAssets } from '../assets/assetManifest.js';
import { resolvePageAssetUrl, resolvePagesUrlPrefix } from '../utils/pagePaths.js';

interface ContentFrontmatter {
    title?: string;
    description?: string;
    order?: number;
}

interface DocsNavEntry {
    readonly path: string;
    readonly title: string;
    readonly section?: string;
    readonly order?: number;
}

interface SidebarOverrideEntry {
    readonly path: string;
    readonly title?: string;
    readonly section?: string;
    readonly order?: number;
    readonly hidden?: boolean;
}

type SidebarOverrideFile =
    | { readonly pages?: readonly SidebarOverrideEntry[] }
    | readonly SidebarOverrideEntry[]
    | Record<string, Omit<SidebarOverrideEntry, 'path'> & { readonly path?: string }>;

interface SearchEntry {
    readonly path: string;
    readonly title: string;
    readonly description?: string;
    readonly headings: readonly string[];
    readonly excerpt: string;
    readonly kind: 'docs' | 'page';
}

interface RenderedContentPage {
    readonly href: string;
    readonly outputDir: string;
    readonly outputPath: string;
    readonly html: string;
    readonly headingIds: ReadonlySet<string>;
    readonly sourcePath: string;
}

export function createContentBuilder(context: BuilderContext): Builder {
    return {
        name: 'content',
        async build(): Promise<void> {
            await buildContentPages(context);
            await buildContentManifests(context);
        },
        async publish(): Promise<void> {
            await publishContentPages(context);
            await publishContentManifests(context);
        }
    };
}

async function buildContentPages(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    if (!(await pathExists(contentRoot))) {
        return;
    }

    if (!shouldProcess(context, [{ directory: contentRoot, extensions: ['.md'] }])) {
        return;
    }

    const files = await glob('**/*.md', {
        cwd: contentRoot,
        nodir: true
    });

    if (files.length === 0) {
        return;
    }

    const appTemplatePath = path.join(config.paths.src.app, FILE_NAMES.htmlAppTemplate);
    if (!(await pathExists(appTemplatePath))) {
        throw new Error(`Base application HTML file not found for content pages: ${appTemplatePath}`);
    }

    const templateHtml = await readFile(appTemplatePath);
    validateAppTemplate(templateHtml, appTemplatePath);

    const buildPagesUrlPrefix = resolvePagesUrlPrefix(config.paths.build.frontend, config.paths.build.pages);
    await removeStaleContentOutputs(context, files, buildPagesUrlPrefix);

    for (const relative of files) {
        const sourcePath = path.join(contentRoot, relative);
        const markdown = await readFile(sourcePath);
        const { frontmatter, content } = extractFrontmatter(markdown);
        const htmlBody = (await renderMarkdownDoc(content)).html;

        const segments = resolveDocsSegments(relative);
        const pagePath = path.join(...segments);
        const pageTitle = resolveTitle(frontmatter, content, segments);

        const mergedHtml = mergeContentIntoTemplate(
            templateHtml,
            pageTitle,
            htmlBody,
            frontmatter.description,
            context.enable?.contentNav === true,
            buildPagesUrlPrefix
        );
        const mergedWithOptIn = injectGlobalOptInScripts(mergedHtml, context.enable);

        // Write to build (folder index)
        const targetDir = path.join(config.paths.build.pages, pagePath);
        await ensureDir(targetDir);
        const targetPath = path.join(targetDir, FILES.indexHtml);
        await writeFile(targetPath, mergedWithOptIn);
    }
}

async function publishContentPages(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    if (!(await pathExists(contentRoot))) {
        return;
    }

    const files = await glob('**/*.md', {
        cwd: contentRoot,
        nodir: true
    });

    if (files.length === 0) {
        return;
    }

    const appTemplatePath = path.join(config.paths.src.app, FILE_NAMES.htmlAppTemplate);
    if (!(await pathExists(appTemplatePath))) {
        throw new Error(`Base application HTML file not found for content pages: ${appTemplatePath}`);
    }

    const templateHtml = await readFile(appTemplatePath);
    validateAppTemplate(templateHtml, appTemplatePath);

    const pagesUrlPrefix = resolvePagesUrlPrefix(config.paths.dist.frontend, config.paths.dist.pages);
    const buildPagesUrlPrefix = resolvePagesUrlPrefix(config.paths.build.frontend, config.paths.build.pages);
    await removeStaleContentOutputsForRoot(config.paths.dist.content, files, pagesUrlPrefix);

    const shared = await readSharedAssets(config.paths.dist.frontend);
    const docsManifestRoot = path.join(config.paths.dist.pages, 'docs');
    const docsManifest = await readPageManifest(docsManifestRoot, 'docs');

    if (!docsManifest.css || !docsManifest.js) {
        throw new Error(
            "Content pages require the docs hub assets. Ensure 'src/frontend/pages/docs/index.css' and 'src/frontend/pages/docs/index.(ts|js)' exist, then re-run publish."
        );
    }

    const renderedPages: RenderedContentPage[] = [];

    for (const relative of files) {
        const sourcePath = path.join(contentRoot, relative);
        const markdown = await readFile(sourcePath);
        const { frontmatter, content } = extractFrontmatter(markdown);

        const segments = resolveDocsSegments(relative);
        const pagePath = path.join(...segments);
        const href = '/' + segments.join('/') + '/';
        const pageTitle = resolveTitle(frontmatter, content, segments);

        const rendered = await renderMarkdownDoc(content);
        const htmlBody = rendered.html;

        const mergedHtml = mergeContentIntoTemplate(
            templateHtml,
            pageTitle,
            htmlBody,
            frontmatter.description,
            context.enable?.contentNav === true,
            pagesUrlPrefix
        );
        const mergedWithOptIn = injectGlobalOptInScripts(mergedHtml, context.enable);
        const rewritten = await rewriteContentForPublish(mergedWithOptIn, shared, docsManifest, {
            pagesUrlPrefix,
            buildPagesUrlPrefix
        });

        const distDir = path.join(config.paths.dist.pages, pagePath);
        const distPath = path.join(distDir, FILES.indexHtml);

        renderedPages.push({
            href,
            outputDir: distDir,
            outputPath: distPath,
            html: rewritten,
            headingIds: rendered.headingIds,
            sourcePath
        });
    }

    validateRenderedContentPages(renderedPages);

    for (const page of renderedPages) {
        await ensureDir(page.outputDir);
        await writeFile(page.outputPath, page.html);
    }
}

async function removeStaleContentOutputs(
    context: BuilderContext,
    contentFiles: readonly string[],
    pagesUrlPrefix: string
): Promise<void> {
    await removeStaleContentOutputsForRoot(context.config.paths.build.content, contentFiles, pagesUrlPrefix);
}

async function removeStaleContentOutputsForRoot(
    docsRoot: string,
    contentFiles: readonly string[],
    pagesUrlPrefix: string
): Promise<void> {
    if (!(await pathExists(docsRoot))) {
        return;
    }

    const expected = new Set<string>();
    for (const relative of contentFiles) {
        const segments = resolveDocsSegments(relative);
        expected.add(path.join(...segments.slice(1)));
    }

    const candidateIndexes = await glob('**/index.html', {
        cwd: docsRoot,
        nodir: true
    });

    const docsPrefix = resolvePageAssetUrl(pagesUrlPrefix, 'docs', '');
    const docsAssetToken = docsPrefix.endsWith('/') ? docsPrefix : `${docsPrefix}/`;

    for (const relativeIndex of candidateIndexes) {
        // Keep the docs hub at `/docs/` (index.html).
        if (relativeIndex === FILES.indexHtml) {
            continue;
        }

        const pageDir = path.dirname(relativeIndex);
        if (!pageDir || pageDir === '.' || expected.has(pageDir)) {
            continue;
        }

        const absoluteIndex = path.join(docsRoot, relativeIndex);
        const html = await readFile(absoluteIndex);

        // Only remove pages that were generated by the content pipeline (avoid deleting user-owned pages under /docs).
        const looksLikeContentOutput = html.includes('class="docs-article"')
            && html.includes(docsAssetToken);
        if (!looksLikeContentOutput) {
            continue;
        }

        await remove(path.join(docsRoot, pageDir));
    }
}

async function buildContentManifests(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    if (!(await pathExists(contentRoot))) {
        // Still allow search.json to be created from regular pages.
        if (context.enable?.search === true) {
            const pageEntries = await collectPageSearchEntries(context);
            if (pageEntries.length > 0) {
                await writeSearchManifest([config.paths.build.frontend], pageEntries);
            }
        }
        return;
    }

    if (!shouldProcess(context, [
        { directory: contentRoot, extensions: ['.md'] },
        // `webstir enable search` updates package.json and should emit the index immediately.
        { directory: config.paths.workspace, extensions: ['.json'] }
    ])) {
        return;
    }

    const navEntries = await collectContentManifests(context);
    if (navEntries.length === 0) {
        return;
    }

    await writeContentNavManifest([config.paths.build.frontend], navEntries);

    if (context.enable?.search === true) {
        const [docEntries, pageEntries] = await Promise.all([
            collectContentSearchEntries(context),
            collectPageSearchEntries(context)
        ]);
        const searchEntries = [...docEntries, ...pageEntries];
        if (searchEntries.length > 0) {
            await writeSearchManifest([config.paths.build.frontend], searchEntries);
        }
    }
}

async function publishContentManifests(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    const hasContent = await pathExists(contentRoot);

    const navEntries = hasContent ? await collectContentManifests(context) : [];

    if (navEntries.length > 0) {
        await writeContentNavManifest([config.paths.dist.frontend], navEntries);
    }

    if (context.enable?.search === true) {
        const [docEntries, pageEntries] = await Promise.all([
            hasContent ? collectContentSearchEntries(context) : Promise.resolve([]),
            collectPageSearchEntries(context)
        ]);
        const searchEntries = [...docEntries, ...pageEntries];
        if (searchEntries.length > 0) {
            await writeSearchManifest([config.paths.dist.frontend], searchEntries);
        }
    }
}

async function collectContentManifests(context: BuilderContext): Promise<DocsNavEntry[]> {
    const { config } = context;
    const contentRoot = config.paths.src.content;
    const overrides = await loadSidebarOverrides(contentRoot);

    const files = await glob('**/*.md', {
        cwd: contentRoot,
        nodir: true
    });

    if (files.length === 0) {
        return [];
    }

    const navEntries: DocsNavEntry[] = [];

    for (const relative of files) {
        const sourcePath = path.join(contentRoot, relative);
        const markdown = await readFile(sourcePath);
        const { frontmatter, content } = extractFrontmatter(markdown);

        const segments = resolveDocsSegments(relative);
        const parsed = path.parse(relative);
        const section =
            parsed.dir && parsed.dir.trim().length > 0
            ? parsed.dir.split(path.sep)[0]
            : undefined;

        const href = '/' + segments.join('/') + '/';
        const title = resolveTitle(frontmatter, content, segments);
        const order = frontmatter.order;

        const baseEntry: DocsNavEntry = {
            path: href,
            title,
            section,
            order
        };

        const merged = applySidebarOverride(baseEntry, overrides);
        if (merged) {
            navEntries.push(merged);
        }
    }

    navEntries.sort((a, b) => {
        const aSection = a.section ?? '';
        const bSection = b.section ?? '';
        if (aSection !== bSection) {
            return aSection.localeCompare(bSection);
        }

        const aOrder = typeof a.order === 'number' ? a.order : 0;
        const bOrder = typeof b.order === 'number' ? b.order : 0;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        return a.path.localeCompare(b.path);
    });

    return navEntries;
}

async function writeContentNavManifest(
    outputRoots: readonly string[],
    navEntries: readonly DocsNavEntry[]
): Promise<void> {
    for (const outputRoot of outputRoots) {
        const navOutputPath = path.join(outputRoot, 'docs-nav.json');

        await ensureDir(path.dirname(navOutputPath));
        await writeFile(navOutputPath, JSON.stringify(navEntries, undefined, 2));
    }
}

async function collectContentSearchEntries(context: BuilderContext): Promise<SearchEntry[]> {
    const { config } = context;
    const contentRoot = config.paths.src.content;
    const overrides = await loadSidebarOverrides(contentRoot);

    const files = await glob('**/*.md', {
        cwd: contentRoot,
        nodir: true
    });

    if (files.length === 0) {
        return [];
    }

    const entries: SearchEntry[] = [];

    for (const relative of files) {
        const sourcePath = path.join(contentRoot, relative);
        const markdown = await readFile(sourcePath);
        const { frontmatter, content } = extractFrontmatter(markdown);

        const segments = resolveDocsSegments(relative);
        const href = '/' + segments.join('/') + '/';
        const rawTitle = resolveTitle(frontmatter, content, segments);
        const title = applySidebarTitleOverride(href, rawTitle, overrides);
        if (!title) {
            continue;
        }

        const html = (await renderMarkdownDoc(content)).html;
        const document = load(html);
        const headings = document('h2, h3')
            .toArray()
            .map((element) => document(element).text().trim())
            .filter((text) => text.length > 0);

        const plainText = document.text().replace(/\s+/g, ' ').trim();
        const excerpt = plainText.length > 240 ? `${plainText.slice(0, 240).trim()}…` : plainText;

        entries.push({
            path: href,
            title,
            description: frontmatter.description?.trim() ? frontmatter.description.trim() : undefined,
            headings,
            excerpt,
            kind: 'docs'
        });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
}

async function loadSidebarOverrides(contentRoot: string): Promise<Map<string, SidebarOverrideEntry>> {
    const overridesPath = path.join(contentRoot, '_sidebar.json');
    if (!(await pathExists(overridesPath))) {
        return new Map();
    }

    const parsed = await readJson<SidebarOverrideFile>(overridesPath);
    const map = new Map<string, SidebarOverrideEntry>();

    if (!parsed) {
        return map;
    }

    const pages = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { pages?: unknown }).pages)
            ? (parsed as { pages: unknown }).pages as readonly SidebarOverrideEntry[]
            : null;

    if (pages) {
        for (let index = 0; index < pages.length; index += 1) {
            const entry = pages[index];
            if (!entry || typeof entry !== 'object') {
                continue;
            }

            const normalized = normalizeDocsOverrideHref((entry as SidebarOverrideEntry).path);
            if (!normalized) {
                continue;
            }

            const defaultOrder = typeof (entry as SidebarOverrideEntry).order === 'number'
                ? (entry as SidebarOverrideEntry).order
                : index + 1;

            map.set(normalized, {
                ...entry,
                path: normalized,
                order: defaultOrder
            });
        }

        return map;
    }

    if (typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') {
                continue;
            }

            const rawPath = typeof (value as { path?: unknown }).path === 'string' ? String((value as { path?: unknown }).path) : key;
            const normalized = normalizeDocsOverrideHref(rawPath);
            if (!normalized) {
                continue;
            }

            const title = typeof (value as { title?: unknown }).title === 'string' ? String((value as { title?: unknown }).title) : undefined;
            const section = typeof (value as { section?: unknown }).section === 'string' ? String((value as { section?: unknown }).section) : undefined;
            const hidden = typeof (value as { hidden?: unknown }).hidden === 'boolean' ? Boolean((value as { hidden?: unknown }).hidden) : undefined;
            const orderValue = (value as { order?: unknown }).order;
            const order = typeof orderValue === 'number' && Number.isFinite(orderValue) ? orderValue : undefined;

            map.set(normalized, { path: normalized, title, section, hidden, order });
        }
    }

    return map;
}

function applySidebarOverride(entry: DocsNavEntry, overrides: ReadonlyMap<string, SidebarOverrideEntry>): DocsNavEntry | null {
    const key = normalizeDocsOverrideHref(entry.path);
    const override = key ? overrides.get(key) : undefined;
    if (!override) {
        return entry;
    }

    if (override.hidden === true) {
        return null;
    }

    const title = typeof override.title === 'string' && override.title.trim().length > 0 ? override.title.trim() : entry.title;
    const section = typeof override.section === 'string' && override.section.trim().length > 0 ? override.section.trim() : entry.section;
    const order = typeof override.order === 'number' && Number.isFinite(override.order) ? override.order : entry.order;

    return {
        path: entry.path,
        title,
        section,
        order
    };
}

function applySidebarTitleOverride(
    href: string,
    fallbackTitle: string,
    overrides: ReadonlyMap<string, SidebarOverrideEntry>
): string | null {
    const key = normalizeDocsOverrideHref(href);
    const override = key ? overrides.get(key) : undefined;
    if (!override) {
        return fallbackTitle;
    }

    if (override.hidden === true) {
        return null;
    }

    const title = typeof override.title === 'string' && override.title.trim().length > 0 ? override.title.trim() : fallbackTitle;
    return title;
}

function normalizeDocsOverrideHref(value: string): string | null {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
        return null;
    }

    const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (!withSlash.startsWith('/docs/')) {
        return null;
    }

    if (withSlash.endsWith('/')) {
        return withSlash;
    }

    return `${withSlash}/`;
}

async function collectPageSearchEntries(context: BuilderContext): Promise<SearchEntry[]> {
    const { config } = context;
    const pages = await getPageDirectories(config.paths.src.pages);
    if (pages.length === 0) {
        return [];
    }

    const entries: SearchEntry[] = [];

    for (const page of pages) {
        const sourceIndex = path.join(page.directory, FILES.indexHtml);
        if (!(await pathExists(sourceIndex))) {
            continue;
        }

        const html = await readFile(sourceIndex);
        const document = load(html);

        const titleFromTag = document('title').first().text().trim();
        const titleFromH1 = document('h1').first().text().trim();
        const title = titleFromTag || titleFromH1 || toTitleCase(page.name);

        const description =
            document('meta[name="description"]').first().attr('content')?.trim()
            || undefined;

        const headings = document('h2, h3')
            .toArray()
            .map((element) => document(element).text().trim())
            .filter((text) => text.length > 0);

        const mainText = (document('main').first().text() || document.text()).replace(/\s+/g, ' ').trim();
        const excerpt = mainText.length > 240 ? `${mainText.slice(0, 240).trim()}…` : mainText;

        entries.push({
            path: resolvePageHref(page.name),
            title,
            description,
            headings,
            excerpt,
            kind: 'page'
        });
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
}

function resolvePageHref(pageName: string): string {
    if (pageName === FOLDERS.home) {
        return '/';
    }
    return `/${pageName}/`;
}

async function writeSearchManifest(outputRoots: readonly string[], entries: readonly SearchEntry[]): Promise<void> {
    for (const outputRoot of outputRoots) {
        const outputPath = path.join(outputRoot, 'search.json');
        await ensureDir(path.dirname(outputPath));
        await writeFile(outputPath, JSON.stringify(entries, undefined, 2));
    }
}

function resolveDocsSegments(relative: string): string[] {
    const parsed = path.parse(relative);
    const segments: string[] = ['docs'];

    if (parsed.dir) {
        segments.push(...parsed.dir.split(path.sep));
    }

    const isReadme = parsed.name.toLowerCase() === 'readme';
    const isFolderIndex = parsed.name === 'index' || isReadme;

    // Reserve `/docs/` for a potential docs landing page; root docs become `/docs/<name>/`.
    if (!isFolderIndex || !parsed.dir) {
        segments.push(parsed.name);
    }

    return segments;
}

function extractFrontmatter(markdown: string): { frontmatter: ContentFrontmatter; content: string } {
    const lines = markdown.split(/\r?\n/);
    if (lines.length === 0 || lines[0].trim() !== '---') {
        return { frontmatter: {}, content: markdown };
    }

    const frontmatterLines: string[] = [];
    let closingIndex = -1;

    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === '---') {
            closingIndex = index;
            break;
        }
        frontmatterLines.push(line);
    }

    if (closingIndex === -1) {
        return { frontmatter: {}, content: markdown };
    }

    const frontmatter: ContentFrontmatter = {};

    for (const line of frontmatterLines) {
        const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
        if (!match) {
            continue;
        }

        const key = match[1].trim();
        const rawValue = match[2].trim();

        if (key === 'title') {
            frontmatter.title = rawValue;
        } else if (key === 'description') {
            frontmatter.description = rawValue;
        } else if (key === 'order') {
            const parsed = Number.parseInt(rawValue, 10);
            if (!Number.isNaN(parsed)) {
                frontmatter.order = parsed;
            }
        }
    }

    const content = lines.slice(closingIndex + 1).join('\n');
    return { frontmatter, content };
}

function resolveTitle(frontmatter: ContentFrontmatter, content: string, segments: string[]): string {
    if (frontmatter.title && frontmatter.title.trim()) {
        return frontmatter.title.trim();
    }

    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
        return headingMatch[1].trim();
    }

    const fallbackSegment = segments[segments.length - 1] ?? 'docs';
    const normalized = fallbackSegment.replace(/[-_]/g, ' ');
    return toTitleCase(normalized);
}

function toTitleCase(value: string): string {
    return value
        .split(/\s+/)
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function validateAppTemplate(html: string, filePath: string): void {
    const doc = load(html);
    if (doc('main').length === 0) {
        throw new Error(`Base template missing <main> container (${filePath}).`);
    }
    if (doc('head').length === 0) {
        throw new Error(`Base template missing <head> section (${filePath}).`);
    }
}

function mergeContentIntoTemplate(
    appHtml: string,
    pageName: string,
    bodyHtml: string,
    description: string | undefined,
    enableContentNav: boolean,
    pagesUrlPrefix: string
): string {
    const document = load(appHtml);

    const main = document('main').first();
    const head = document('head').first();
    if (main.length === 0 || head.length === 0) {
        throw new Error('Base application template for content pages must include <head> and <main> elements.');
    }

    if (description && description.trim()) {
        const meta = head.find('meta[name="description"]').first();
        if (meta.length > 0) {
            meta.attr('content', description.trim());
        } else {
            head.append(`<meta name="description" content="${escapeHtml(description.trim())}" />`);
        }
    }
    const defaultDescription = head.find('meta[name="description"]').first().attr('content')?.trim() ?? '';
    const effectiveDescription = (description ?? '').trim() || defaultDescription;

    // Ensure content pages load the shared app styles.
    const cssHref = `/${FOLDERS.app}/app.css`;
    const existingStylesheet =
        head.find(`link[rel="stylesheet"][href="${cssHref}"]`).first().length > 0
        || head.find('link[rel="stylesheet"]').toArray().some((element) => {
            const href = document(element).attr('href');
            return typeof href === 'string' && href.includes('/app/app.css');
        });
    if (!existingStylesheet) {
        head.append(`<link rel="stylesheet" href="${cssHref}" />`);
    }

    // Ensure docs pages load the docs layout styles.
    const docsCssHref = resolvePageAssetUrl(pagesUrlPrefix, 'docs', `${FILES.index}${EXTENSIONS.css}`);
    const existingDocsStylesheet =
        head.find(`link[rel="stylesheet"][href="${docsCssHref}"]`).first().length > 0
        || head.find('link[rel="stylesheet"]').toArray().some((element) => {
            const href = document(element).attr('href');
            return typeof href === 'string' && href.includes('/docs/index.css');
        });
    if (!existingDocsStylesheet) {
        head.append(`<link rel="stylesheet" href="${docsCssHref}" />`);
    }

    // Best-effort: ensure the document has a sensible title for the content page.
    const title = head.find('title').first();
    if (title.length === 0) {
        head.append(`<title>${escapeHtml(pageName)}</title>`);
    } else if (!title.text().trim()) {
        title.text(pageName);
    } else {
        const baseTitle = title.text().trim();
        if (!baseTitle.includes(pageName)) {
            title.text(`${pageName} – ${baseTitle}`);
        }
    }
    const effectiveTitle = head.find('title').first().text().trim() || pageName;

    ensureMetaProperty(head, 'og:title', effectiveTitle);
    if (effectiveDescription) {
        ensureMetaProperty(head, 'og:description', effectiveDescription);
    }
    ensureMetaProperty(head, 'og:type', 'website');
    ensureMetaName(head, 'twitter:card', 'summary');
    ensureMetaName(head, 'twitter:title', effectiveTitle);
    if (effectiveDescription) {
        ensureMetaName(head, 'twitter:description', effectiveDescription);
    }

    const docsLayoutHtml = enableContentNav
        ? [
            '<section class="docs-layout" data-scope="docs" data-content-nav="true">',
            '  <div class="ws-container docs-layout__inner">',
            '    <aside class="docs-sidebar" id="docs-sidebar" data-docs-sidebar hidden>',
            '      <div class="docs-panel__header">',
            '        <a class="docs-panel__link" href="/docs/">Docs</a>',
            '      </div>',
            '      <nav class="docs-nav" data-docs-nav aria-label="Docs navigation" hidden></nav>',
            '    </aside>',
            '    <div class="docs-main">',
            '      <div class="docs-toolbar" data-docs-toolbar hidden>',
            '        <nav class="docs-breadcrumb" data-docs-breadcrumb aria-label="Breadcrumb" hidden></nav>',
            '      </div>',
            '      <div class="docs-main__content ws-flow">',
            `        <article class="docs-article ws-markdown" data-docs-article>${bodyHtml}</article>`,
            '      </div>',
            '    </div>',
            '  </div>',
            '</section>'
        ].join('\n')
        : [
            '<section class="docs-layout" data-scope="docs">',
            '  <div class="ws-container docs-layout__inner">',
            '    <div class="docs-main ws-flow">',
            `      <article class="docs-article ws-markdown">${bodyHtml}</article>`,
            '    </div>',
            '  </div>',
            '</section>'
        ].join('\n');

    main.html(docsLayoutHtml);

    return document.root().html() ?? '';
}

function ensureMetaProperty(head: Cheerio<AnyNode>, property: string, content: string): void {
    const escaped = escapeHtml(content);
    const meta = head.find(`meta[property="${property}"]`).first();
    if (meta.length > 0) {
        meta.attr('content', escaped);
        return;
    }
    head.append(`<meta property="${property}" content="${escaped}" />`);
}

function ensureMetaName(head: Cheerio<AnyNode>, name: string, content: string): void {
    const escaped = escapeHtml(content);
    const meta = head.find(`meta[name="${name}"]`).first();
    if (meta.length > 0) {
        meta.attr('content', escaped);
        return;
    }
    head.append(`<meta name="${name}" content="${escaped}" />`);
}

async function renderMarkdownDoc(markdown: string): Promise<{ html: string; headingIds: ReadonlySet<string> }> {
    const renderer = getMarkdownRenderer();
    const expanded = await expandAdmonitions(markdown, renderer);
    const rawHtml = await marked.parse(expanded, { renderer: renderer as any });
    const linked = rewriteMarkdownLinks(rawHtml);
    const { html, headingIds } = ensureHeadingIds(linked);
    return { html, headingIds };
}

function getMarkdownRenderer(): unknown {
    const w = globalThis as unknown as Record<string, unknown>;
    const key = '__webstirMarkedRendererV1';
    const existing = w[key] as unknown | undefined;
    if (existing) {
        return existing;
    }

    const renderer = new marked.Renderer();

    // Marked v12 renderer signature is not stable in TS types; keep it permissive.
    (renderer as unknown as { code: (code: string, infostring?: string) => string }).code = (
        code: string,
        infostring?: string
    ): string => {
        const rawLang = typeof infostring === 'string' ? infostring.trim().split(/\s+/)[0] : '';
        const lang = rawLang ? rawLang.toLowerCase() : '';

        try {
            if (lang && hljs.getLanguage(lang)) {
                const highlighted = hljs.highlight(code, { language: lang }).value;
                return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
            }

            const highlighted = hljs.highlightAuto(code).value;
            return `<pre><code class="hljs">${highlighted}</code></pre>`;
        } catch {
            return `<pre><code>${escapeHtml(code)}</code></pre>`;
        }
    };

    w[key] = renderer;
    return renderer;
}

type AdmonitionKind = 'note' | 'tip' | 'info' | 'warning' | 'danger';

const ADMONITION_TITLES: Record<AdmonitionKind, string> = {
    note: 'Note',
    tip: 'Tip',
    info: 'Info',
    warning: 'Warning',
    danger: 'Danger'
};

async function expandAdmonitions(markdown: string, renderer: unknown): Promise<string> {
    const lines = markdown.split(/\r?\n/);
    const out: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const match = line.match(/^:::\s*([A-Za-z]+)(?:\s+(.*))?\s*$/);
        if (!match) {
            out.push(line);
            continue;
        }

        const kindRaw = match[1]?.toLowerCase() ?? '';
        if (!isAdmonitionKind(kindRaw)) {
            out.push(line);
            continue;
        }

        const title = (match[2] ?? '').trim() || ADMONITION_TITLES[kindRaw];

        const inner: string[] = [];
        let closed = false;
        for (index = index + 1; index < lines.length; index += 1) {
            const innerLine = lines[index] ?? '';
            if (innerLine.trim() === ':::') {
                closed = true;
                break;
            }
            inner.push(innerLine);
        }

        if (!closed) {
            // Unterminated block; treat it as literal markdown.
            out.push(line);
            out.push(...inner);
            break;
        }

        const bodyMarkdown = inner.join('\n').trim();
        const bodyHtml = bodyMarkdown.length > 0 ? await marked.parse(bodyMarkdown, { renderer: renderer as any }) : '';

        out.push(
            [
                `<aside class="docs-callout docs-callout--${kindRaw}">`,
                `  <div class="docs-callout__title">${escapeHtml(title)}</div>`,
                `  <div class="docs-callout__body">${bodyHtml}</div>`,
                `</aside>`
            ].join('\n')
        );
    }

    return out.join('\n');
}

function isAdmonitionKind(value: string): value is AdmonitionKind {
    return value === 'note' || value === 'tip' || value === 'info' || value === 'warning' || value === 'danger';
}

function ensureHeadingIds(html: string): { html: string; headingIds: ReadonlySet<string> } {
    const document = load(html);
    const used = new Set<string>();
    const ids = new Set<string>();

    const headings = document('h1, h2, h3, h4').toArray();
    for (const element of headings) {
        const heading = document(element);
        const existing = heading.attr('id')?.trim();
        if (existing) {
            used.add(existing);
            ids.add(existing);
            continue;
        }

        const text = heading.text().trim();
        const base = slugifyHeading(text) || 'section';
        let candidate = base;
        let counter = 2;
        while (used.has(candidate)) {
            candidate = `${base}-${counter}`;
            counter += 1;
        }

        used.add(candidate);
        ids.add(candidate);
        heading.attr('id', candidate);
    }

    return { html: document.root().html() ?? html, headingIds: ids };
}

function slugifyHeading(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function validateRenderedContentPages(pages: readonly RenderedContentPage[]): void {
    if (pages.length === 0) {
        return;
    }

    const headingsByHref = new Map<string, ReadonlySet<string>>(pages.map((page) => [page.href, page.headingIds]));
    const knownHrefs = new Set<string>(pages.map((page) => page.href));
    knownHrefs.add('/docs/');

    const errors: string[] = [];

    for (const page of pages) {
        const document = load(page.html);
        const anchors = document('.docs-article a[href]').toArray();

        for (const element of anchors) {
            const href = document(element).attr('href') ?? '';
            if (!href) {
                continue;
            }

            if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
                continue;
            }

            const resolved = resolveHref(page.href, href);
            if (!resolved) {
                continue;
            }

            const isDocsPage =
                resolved.pathname === '/docs'
                || resolved.pathname === '/docs/'
                || resolved.pathname.startsWith('/docs/');
            if (!isDocsPage) {
                continue;
            }

            const targetHref = normalizeDocsHref(resolved.pathname);
            if (!knownHrefs.has(targetHref)) {
                errors.push(`${page.sourcePath}: broken docs link '${href}' → '${targetHref}'`);
                continue;
            }

            const hash = resolved.hash.startsWith('#') ? resolved.hash.slice(1) : resolved.hash;
            if (!hash) {
                continue;
            }

            const targetHeadings = headingsByHref.get(targetHref);
            if (!targetHeadings) {
                continue;
            }

            if (!targetHeadings.has(hash)) {
                errors.push(`${page.sourcePath}: broken anchor '${href}' (missing '#${hash}' on ${targetHref})`);
            }
        }
    }

    if (errors.length === 0) {
        return;
    }

    const preview = errors.slice(0, 12).join('\n');
    const suffix = errors.length > 12 ? `\n… and ${errors.length - 12} more.` : '';
    throw new Error(`Markdown content contains broken internal links/anchors:\n${preview}${suffix}`);
}

function resolveHref(baseHref: string, href: string): URL | null {
    try {
        const base = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
        return new URL(href, `http://webstir.local${base}`);
    } catch {
        return null;
    }
}

function normalizeDocsHref(pathname: string): string {
    if (pathname === '/docs' || pathname === '/docs/' || pathname === '/docs/index.html') {
        return '/docs/';
    }

    if (pathname.endsWith('/index.html')) {
        return pathname.slice(0, -'index.html'.length);
    }

    if (pathname.startsWith('/docs') && !pathname.endsWith('/')) {
        return `${pathname}/`;
    }

    return pathname;
}

function injectGlobalOptInScripts(
    html: string,
    enable: BuilderContext['enable']
): string {
    if (!enable) {
        return html;
    }
    return html;
}

async function rewriteContentForPublish(
    html: string,
    shared: { css?: string; js?: string } | null,
    docsManifest: { js?: string; css?: string },
    options: {
        readonly pagesUrlPrefix: string;
        readonly buildPagesUrlPrefix: string;
    }
): Promise<string> {
    const document = load(html);
    const { pagesUrlPrefix, buildPagesUrlPrefix } = options;

    document('script[src="/hmr.js"]').remove();
    document('script[src="/refresh.js"]').remove();

    if (shared?.css) {
        document(`link[href="/app/app.css"]`).attr('href', `/app/${shared.css}`);
    }
    if (shared?.js) {
        document(`script[src="/app/app.js"]`)
            .attr('src', `/app/${shared.js}`)
            .attr('type', 'module');
    }

    if (docsManifest.css) {
        const selector = [
            `link[href="${resolvePageAssetUrl(pagesUrlPrefix, 'docs', `${FILES.index}${EXTENSIONS.css}`)}"]`,
            `link[href="${resolvePageAssetUrl(buildPagesUrlPrefix, 'docs', `${FILES.index}${EXTENSIONS.css}`)}"]`
        ].join(', ');
        document(selector).attr('href', resolvePageAssetUrl(pagesUrlPrefix, 'docs', docsManifest.css));
    }

    if (docsManifest.js) {
        const selector = [
            `script[src="${resolvePageAssetUrl(pagesUrlPrefix, 'docs', `${FILES.index}${EXTENSIONS.js}`)}"]`,
            `script[src="${resolvePageAssetUrl(buildPagesUrlPrefix, 'docs', `${FILES.index}${EXTENSIONS.js}`)}"]`
        ].join(', ');
        document(selector)
            .attr('src', resolvePageAssetUrl(pagesUrlPrefix, 'docs', docsManifest.js))
            .attr('type', 'module');
    }

    return document.root().html() ?? html;
}

function rewriteMarkdownLinks(html: string): string {
    const document = load(html);
    document('a[href]').each((_, element) => {
        const anchor = document(element);
        const href = anchor.attr('href');
        if (!href) return;

        // Only rewrite local .md links (no protocol, no leading //)
        if (/^[a-z]+:\/\//i.test(href) || href.startsWith('//')) {
            return;
        }

        const mdMatch = href.match(/^(.*?)(\.md)(#.*)?$/i);
        if (!mdMatch) return;

        const base = mdMatch[1];
        const hash = mdMatch[3] ?? '';
        const normalizedBase = base.endsWith('/') ? base : `${base}/`;

        // Preserve relative path segments; remove the .md extension and ensure trailing slash
        anchor.attr('href', `${normalizedBase}${hash}`);
    });

    return document.root().html() ?? html;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
