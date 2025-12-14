import path from 'node:path';
import { glob } from 'glob';
import { marked } from 'marked';
import { load } from 'cheerio';
import { FOLDERS, FILES, FILE_NAMES } from '../core/constants.js';
import { ensureDir, pathExists, readFile, writeFile } from '../utils/fs.js';
import type { Builder, BuilderContext } from './types.js';
import { shouldProcess } from '../utils/changedFile.js';

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

export function createContentBuilder(context: BuilderContext): Builder {
    return {
        name: 'content',
        async build(): Promise<void> {
            await buildContentPages(context);
            await buildContentManifests(context);
        },
        async publish(): Promise<void> {
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

    for (const relative of files) {
        const sourcePath = path.join(contentRoot, relative);
        const markdown = await readFile(sourcePath);
        const { frontmatter, content } = extractFrontmatter(markdown);
        const htmlBody = rewriteMarkdownLinks(await marked.parse(content));

        const segments = resolveDocsSegments(relative);
        const pagePath = path.join(...segments);
        const pageTitle = resolveTitle(frontmatter, content, segments);

        const mergedHtml = mergeContentIntoTemplate(templateHtml, pageTitle, htmlBody);

        // Write to build (folder index)
        const targetDir = path.join(config.paths.build.frontend, FOLDERS.pages, pagePath);
        await ensureDir(targetDir);
        const targetPath = path.join(targetDir, FILES.indexHtml);
        await writeFile(targetPath, mergedHtml);

        // Mirror to dist so static hosting uses pre-rendered docs too
        const distDir = path.join(config.paths.dist.frontend, FOLDERS.pages, pagePath);
        await ensureDir(distDir);
        const distPath = path.join(distDir, FILES.indexHtml);
        await writeFile(distPath, mergedHtml);
    }
}

async function buildContentManifests(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    if (!(await pathExists(contentRoot))) {
        return;
    }

    if (!shouldProcess(context, [{ directory: contentRoot, extensions: ['.md'] }])) {
        return;
    }

    const navEntries = await collectContentManifests(context);
    if (navEntries.length === 0) {
        return;
    }

    await writeContentNavManifest([config.paths.build.frontend, config.paths.dist.frontend], navEntries);
}

async function publishContentManifests(context: BuilderContext): Promise<void> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

    if (!(await pathExists(contentRoot))) {
        return;
    }

    const navEntries = await collectContentManifests(context);
    if (navEntries.length === 0) {
        return;
    }

    await writeContentNavManifest([config.paths.dist.frontend], navEntries);
}

async function collectContentManifests(context: BuilderContext): Promise<DocsNavEntry[]> {
    const { config } = context;
    const contentRoot = config.paths.src.content;

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
            : 'General';

        const href = '/' + segments.join('/') + '/';
        const title = resolveTitle(frontmatter, content, segments);
        const order = frontmatter.order;

        navEntries.push({
            path: href,
            title,
            section,
            order
        });
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

function mergeContentIntoTemplate(appHtml: string, pageName: string, bodyHtml: string): string {
    const document = load(appHtml);

    const main = document('main').first();
    const head = document('head').first();
    if (main.length === 0 || head.length === 0) {
        throw new Error('Base application template for content pages must include <head> and <main> elements.');
    }

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
    const docsCssHref = `/${FOLDERS.pages}/docs/index.css`;
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

    const docsLayoutHtml = [
        '<section class="docs-layout">',
        '  <div class="container docs-layout__inner">',
        '    <aside class="docs-sidebar" aria-label="Docs navigation">',
        '      <div class="docs-sidebar__header">',
        '        <a class="docs-sidebar__title" href="/docs/">Docs</a>',
        '      </div>',
        '      <nav class="docs-nav" aria-label="Docs pages">',
        '        <ul id="docs-links" class="docs-links"></ul>',
        '      </nav>',
        '    </aside>',
        '    <div class="docs-main">',
        `      <article class="docs-article">${bodyHtml}</article>`,
        '    </div>',
        '  </div>',
        '</section>',
        `<script type="module" src="/${FOLDERS.pages}/docs/index.js"></script>`
    ].join('\n');

    main.html(docsLayoutHtml);

    return document.root().html() ?? '';
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
