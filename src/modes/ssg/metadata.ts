import path from 'node:path';
import { readJson, writeJson } from '../../utils/fs.js';
import type { WorkspaceModuleView, WorkspacePackageJson } from '../../config/workspaceManifest.js';

export interface SsgViewMetadataOptions {
    readonly workspaceRoot: string;
    readonly pageName: string;
}

export async function ensureSsgViewMetadataForPage(options: SsgViewMetadataOptions): Promise<void> {
    const pkgPath = path.join(options.workspaceRoot, 'package.json');
    const pkg = (await readJson<WorkspacePackageJson>(pkgPath)) ?? {};
    const workspaceMode = pkg.webstir?.mode;
    const isSsgWorkspace = typeof workspaceMode === 'string' && workspaceMode.toLowerCase() === 'ssg';
    if (isSsgWorkspace) {
        return;
    }

    const webstir = pkg.webstir ?? {};
    const moduleConfig = webstir.moduleManifest ?? {};
    const existingViews = Array.isArray(moduleConfig.views) ? [...moduleConfig.views] : [];

    const pageName = options.pageName;
    const isHome = pageName === 'home';
    const viewName = `${capitalize(pageName)}View`;
    const viewPath = isHome ? '/' : `/${pageName}`;

    const existingIndex = existingViews.findIndex((view) => view?.name === viewName || view?.path === viewPath);
    const existing = existingIndex >= 0 ? (existingViews[existingIndex] ?? {}) : {};
    const nextView: WorkspaceModuleView = {
        ...existing,
        name: viewName,
        path: viewPath,
        renderMode: 'ssg',
        staticPaths: [viewPath]
    };

    if (existingIndex >= 0) {
        existingViews[existingIndex] = nextView;
    } else {
        existingViews.push(nextView);
    }

    const nextPkg: WorkspacePackageJson = {
        ...pkg,
        webstir: {
            ...webstir,
            moduleManifest: {
                ...moduleConfig,
                views: existingViews
            }
        }
    };

    await writeJson(pkgPath, nextPkg);
}

function capitalize(value: string): string {
    if (!value) {
        return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
}
