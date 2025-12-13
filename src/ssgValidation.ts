import path from 'node:path';
import { readJson } from './utils/fs.js';

interface WorkspaceModuleRouteGuard {
    readonly renderMode?: unknown;
    readonly staticPaths?: unknown;
    readonly ssg?: unknown;
}

interface WorkspaceModuleConfigGuard {
    readonly routes?: readonly WorkspaceModuleRouteGuard[];
}

interface WorkspacePackageJsonGuard {
    readonly webstir?: {
        readonly moduleManifest?: WorkspaceModuleConfigGuard;
    };
}

export function assertNoSsgRoutesInModuleConfig(moduleConfig: WorkspaceModuleConfigGuard | undefined): void {
    const routes = moduleConfig?.routes ?? [];
    if (!Array.isArray(routes) || routes.length === 0) {
        return;
    }

    const hasSsgRoute = routes.some((route) => {
        if (!route || typeof route !== 'object') {
            return false;
        }

        const renderMode = typeof route.renderMode === 'string' ? route.renderMode.toLowerCase() : undefined;
        const hasStaticPaths = Array.isArray(route.staticPaths) && route.staticPaths.length > 0;
        const hasSsgBlock = route.ssg !== undefined;

        return renderMode === 'ssg' || hasStaticPaths || hasSsgBlock;
    });

    if (!hasSsgRoute) {
        return;
    }

    throw new Error(
        "SSG publish expects SSG metadata under `webstir.moduleManifest.views`, not `webstir.moduleManifest.routes`. Move `renderMode: 'ssg'`, `staticPaths`, and/or `ssg` onto the corresponding view definition."
    );
}

export async function assertNoSsgRoutes(workspaceRoot: string): Promise<void> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJsonGuard>(pkgPath);
    const moduleConfig = pkg?.webstir?.moduleManifest;
    assertNoSsgRoutesInModuleConfig(moduleConfig);
}
