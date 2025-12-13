import path from 'node:path';
import { FOLDERS, FILES } from './core/constants.js';
import type { FrontendConfig } from './types.js';
import { copy, ensureDir, pathExists, readJson } from './utils/fs.js';
import { getPageDirectories } from './core/pages.js';
import { assertNoSsgRoutesInModuleConfig } from './ssgValidation.js';

interface WorkspaceModuleView {
    readonly path?: string;
    readonly renderMode?: 'ssg' | 'ssr' | 'spa';
    readonly staticPaths?: readonly string[];
}

interface WorkspaceModuleRouteGuard {
    readonly renderMode?: unknown;
    readonly staticPaths?: unknown;
    readonly ssg?: unknown;
}

interface WorkspaceModuleConfig {
    readonly views?: readonly WorkspaceModuleView[];
    readonly routes?: readonly WorkspaceModuleRouteGuard[];
}

interface WorkspacePackageJson {
    readonly name?: string;
    readonly webstir?: {
        readonly mode?: string;
        readonly moduleManifest?: WorkspaceModuleConfig;
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
    const workspaceMode = pkg?.webstir?.mode;
    const isSsgWorkspace = typeof workspaceMode === 'string' && workspaceMode.toLowerCase() === 'ssg';
    const moduleConfig = pkg?.webstir?.moduleManifest;
    assertNoSsgRoutesInModuleConfig(moduleConfig);

    const views = moduleConfig?.views ?? [];
    if (views.length === 0) {
        return;
    }

    for (const view of views) {
        const renderMode = view.renderMode ?? (isSsgWorkspace ? 'ssg' : undefined);
        if (renderMode !== 'ssg') {
            continue;
        }

        const paths = getEffectiveStaticPaths(view, isSsgWorkspace);
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

function getEffectiveStaticPaths(view: WorkspaceModuleView, isSsgWorkspace: boolean): readonly string[] {
    const explicitPaths = view.staticPaths ?? [];
    if (explicitPaths.length > 0) {
        return explicitPaths;
    }

    if (!isSsgWorkspace) {
        return [];
    }

    const candidate = view.path ?? '';
    if (!isDefaultStaticPathCandidate(candidate)) {
        return [];
    }

    return [candidate];
}

function isDefaultStaticPathCandidate(template: string): boolean {
    if (typeof template !== 'string') {
        return false;
    }

    const trimmed = template.trim();
    if (!trimmed.startsWith('/')) {
        return false;
    }

    // Avoid treating parameterized or wildcard templates as a single concrete path.
    if (trimmed.includes(':') || trimmed.includes('*')) {
        return false;
    }

    return true;
}
