import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FrontendConfig } from './types.js';
import { ensureDir, pathExists, readJson, writeJson } from './utils/fs.js';
import { FOLDERS } from './core/constants.js';

interface WorkspaceModuleViewMetadata {
    readonly name?: string;
    readonly path?: string;
    readonly renderMode?: 'ssg' | 'ssr' | 'spa';
    readonly staticPaths?: readonly string[];
}

interface WorkspaceModuleConfig {
    readonly views?: readonly WorkspaceModuleViewMetadata[];
}

interface WorkspacePackageJson {
    readonly webstir?: {
        readonly module?: WorkspaceModuleConfig;
    };
}

interface ViewDefinitionLike {
    readonly name?: string;
    readonly path?: string;
    readonly renderMode?: 'ssg' | 'ssr' | 'spa';
    readonly staticPaths?: readonly string[];
}

interface ViewSpecLike {
    readonly definition?: ViewDefinitionLike;
    readonly load?: (context: any) => unknown | Promise<unknown>;
}

interface ModuleDefinitionLike {
    readonly views?: readonly ViewSpecLike[];
}

interface ViewDataEntry {
    readonly viewName: string;
    readonly path: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly data: any;
}

export async function generateSsgViewData(config: FrontendConfig): Promise<void> {
    const workspaceRoot = config.paths.workspace;
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJson>(pkgPath);
    const moduleConfig = pkg?.webstir?.module;
    const viewMetadata = moduleConfig?.views ?? [];

    const moduleDefinition = await loadBackendModuleDefinition(workspaceRoot);
    if (!moduleDefinition?.views || moduleDefinition.views.length === 0) {
        return;
    }

    const perPageData = new Map<string, ViewDataEntry[]>();

    for (const spec of moduleDefinition.views) {
        const definition = spec.definition ?? {};
        const viewName = definition.name ?? '';
        const viewPathTemplate = definition.path ?? '';
        const meta = findViewMetadata(viewMetadata, viewName, viewPathTemplate);
        const renderMode = meta?.renderMode ?? definition.renderMode;
        if (renderMode !== 'ssg') {
            continue;
        }

        const staticPaths = meta?.staticPaths ?? definition.staticPaths ?? [];
        if (!spec.load || !Array.isArray(staticPaths) || staticPaths.length === 0) {
            continue;
        }

        for (const rawPath of staticPaths) {
            if (typeof rawPath !== 'string' || rawPath.length === 0) {
                continue;
            }

            const normalizedPath = normalizePath(rawPath);
            const params = deriveRouteParams(viewPathTemplate, normalizedPath);
            if (!params) {
                continue;
            }

            const ssrContext = createMinimalSsrContext(normalizedPath, params);

            let data: unknown;
            try {
                data = await spec.load(ssrContext);
            } catch {
                // Best-effort only; skip paths that fail to load.
                continue;
            }

            const pageName = normalizedPath === '/' ? FOLDERS.home : firstPathSegment(normalizedPath) ?? FOLDERS.home;
            const entries = perPageData.get(pageName) ?? [];
            entries.push({
                viewName: viewName || viewPathTemplate || normalizedPath,
                path: normalizedPath,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                data
            });
            perPageData.set(pageName, entries);
        }
    }

    if (perPageData.size === 0) {
        return;
    }

    const pagesRoot = config.paths.dist.pages;

    for (const [pageName, entries] of perPageData.entries()) {
        const pageDir = path.join(pagesRoot, pageName);
        if (!(await pathExists(pageDir))) {
            continue;
        }

        const dataPath = path.join(pageDir, 'view-data.json');
        await ensureDir(pageDir);
        await writeJson(dataPath, entries);
    }
}

function findViewMetadata(
    views: readonly WorkspaceModuleViewMetadata[],
    name: string,
    templatePath: string
): WorkspaceModuleViewMetadata | undefined {
    return (
        views.find((view) => (view.name && view.name === name) || (view.path && view.path === templatePath)) ??
        views.find((view) => view.path === templatePath) ??
        views.find((view) => view.name === name)
    );
}

async function loadBackendModuleDefinition(workspaceRoot: string): Promise<ModuleDefinitionLike | undefined> {
    const buildRoot = path.join(workspaceRoot, 'build', 'backend');
    const candidates = [
        path.join(buildRoot, 'module.js'),
        path.join(buildRoot, 'module.mjs'),
        path.join(buildRoot, 'module', 'index.js'),
        path.join(buildRoot, 'module', 'index.mjs')
    ];

    for (const fullPath of candidates) {
        if (!(await pathExists(fullPath))) {
            continue;
        }

        try {
            const url = `${pathToFileURL(fullPath).href}?t=${Date.now()}`;
            const imported = (await import(url)) as Record<string, unknown>;
            const candidate = extractModuleDefinition(imported);
            if (candidate) {
                return candidate;
            }
        } catch {
            // Best-effort only.
        }
    }

    return undefined;
}

function extractModuleDefinition(exports: Record<string, unknown>): ModuleDefinitionLike | undefined {
    const keys = ['module', 'moduleDefinition', 'default', 'backendModule'];
    for (const key of keys) {
        if (key in exports) {
            const value = exports[key as keyof typeof exports];
            if (value && typeof value === 'object') {
                return value as ModuleDefinitionLike;
            }
        }
    }
    return undefined;
}

function normalizePath(value: string): string {
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

function deriveRouteParams(template: string, actual: string): Record<string, string> | null {
    if (!template || !actual) {
        return {};
    }

    const templateSegments = template.split('/').filter(Boolean);
    const actualSegments = actual.split('/').filter(Boolean);

    if (templateSegments.length !== actualSegments.length) {
        return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < templateSegments.length; i++) {
        const templateSegment = templateSegments[i];
        const actualSegment = actualSegments[i];

        if (templateSegment.startsWith(':')) {
            const key = templateSegment.slice(1);
            if (!key) {
                return null;
            }
            params[key] = decodeURIComponent(actualSegment);
        } else if (templateSegment !== actualSegment) {
            return null;
        }
    }

    return params;
}

function createMinimalSsrContext(pathname: string, params: Record<string, string>): unknown {
    const url = new URL(`http://localhost${pathname}`);

    const envAccessor = {
        get(name: string): string | undefined {
            return process.env[name];
        },
        require(name: string): string {
            const value = process.env[name];
            if (value === undefined) {
                throw new Error(`Missing required env variable ${name} for SSG view rendering.`);
            }
            return value;
        },
        entries(): Record<string, string | undefined> {
            return process.env as Record<string, string | undefined>;
        }
    };

    const logger = {
        level: 'info',
        log(_level: string, _message: string, _metadata?: Record<string, unknown>): void {
            // no-op for SSG
        },
        debug(_message: string, _metadata?: Record<string, unknown>): void {
            // no-op for SSG
        },
        info(_message: string, _metadata?: Record<string, unknown>): void {
            // no-op for SSG
        },
        warn(_message: string, _metadata?: Record<string, unknown>): void {
            // no-op for SSG
        },
        error(_message: string, _metadata?: Record<string, unknown>): void {
            // no-op for SSG
        },
        with(_bindings: Record<string, unknown>) {
            return this;
        }
    };

    return {
        url,
        params,
        cookies: {},
        headers: {},
        auth: undefined,
        session: null,
        env: envAccessor,
        logger,
        now: () => new Date()
    };
}
