import path from 'node:path';
import { FOLDERS, FILES } from './core/constants.js';
import type { FrontendConfig } from './types.js';
import { copy, ensureDir, pathExists, readJson } from './utils/fs.js';
import { getPageDirectories } from './core/pages.js';

interface WorkspaceModuleView {
    readonly path?: string;
    readonly renderMode?: 'ssg' | 'ssr' | 'spa';
    readonly staticPaths?: readonly string[];
}

interface WorkspaceModuleConfig {
    readonly views?: readonly WorkspaceModuleView[];
}

interface WorkspacePackageJson {
    readonly name?: string;
    readonly webstir?: {
        readonly module?: WorkspaceModuleConfig;
    };
}

export async function applySsgRouting(config: FrontendConfig): Promise<void> {
    const distRoot = config.paths.dist.frontend;
    const distPagesRoot = config.paths.dist.pages;

    // Ensure a root index.html that aliases the home page when present.
    const homeIndexPath = path.join(distPagesRoot, FOLDERS.home, FILES.indexHtml);
    if (await pathExists(homeIndexPath)) {
        const rootIndexPath = path.join(distRoot, FILES.indexHtml);
        await ensureDir(path.dirname(rootIndexPath));
        await copy(homeIndexPath, rootIndexPath);
    }

    // For each page, create a /<page>/index.html alias to its main HTML file when available.
    const pages = await getPageDirectories(distPagesRoot);
    const pageIndexMap = new Map<string, string>();

    for (const page of pages) {
        const sourceIndex = path.join(page.directory, FILES.indexHtml);
        if (!(await pathExists(sourceIndex))) {
            continue;
        }

        pageIndexMap.set(page.name, sourceIndex);

        const targetDir = path.join(distRoot, page.name);
        await ensureDir(targetDir);
        const targetIndex = path.join(targetDir, FILES.indexHtml);
        await copy(sourceIndex, targetIndex);
    }

    await applyStaticPathAliases(config, distRoot, distPagesRoot, pageIndexMap);
}

async function applyStaticPathAliases(
    config: FrontendConfig,
    distRoot: string,
    distPagesRoot: string,
    pageIndexMap: Map<string, string>
): Promise<void> {
    if (pageIndexMap.size === 0) {
        return;
    }

    const workspaceRoot = config.paths.workspace;
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJson>(pkgPath);
    const moduleConfig = pkg?.webstir?.module;
    const views = moduleConfig?.views ?? [];

    if (views.length === 0) {
        return;
    }

    for (const view of views) {
        if (view.renderMode !== 'ssg') {
            continue;
        }

        const paths = view.staticPaths ?? [];
        for (const raw of paths) {
            if (typeof raw !== 'string' || raw.length === 0) {
                continue;
            }

            const normalized = normalizeStaticPath(raw);
            let sourceIndex: string | undefined;

            if (normalized === '/') {
                sourceIndex = pageIndexMap.get(FOLDERS.home);
            } else {
                const relativePath = normalized.replace(/^\/+/, '');
                const candidate = path.join(distPagesRoot, relativePath, FILES.indexHtml);
                if (await pathExists(candidate)) {
                    sourceIndex = candidate;
                } else {
                    const pageName = firstPathSegment(normalized);
                    if (!pageName) {
                        continue;
                    }
                    sourceIndex = pageIndexMap.get(pageName);
                }
            }

            if (!sourceIndex) {
                continue;
            }

            const targetIndex =
                normalized === '/'
                    ? path.join(distRoot, FILES.indexHtml)
                    : path.join(distRoot, normalized.replace(/^\/+/, ''), FILES.indexHtml);

            await ensureDir(path.dirname(targetIndex));
            await copy(sourceIndex, targetIndex);
        }
    }
}

function normalizeStaticPath(value: string): string {
    let s = value.trim();
    if (!s.startsWith('/')) {
        s = `/${s}`;
    }
    if (s.length > 1 && s.endsWith('/')) {
        s = s.slice(0, -1);
    }
    return s;
}

function firstPathSegment(pathname: string): string | undefined {
    const [, segment] = pathname.split('/');
    if (!segment) {
        return undefined;
    }
    return segment;
}
