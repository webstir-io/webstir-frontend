import path from 'node:path';
import { readJson, writeJson } from './utils/fs.js';

export interface SsgViewMetadataOptions {
    readonly workspaceRoot: string;
    readonly pageName: string;
}

interface WorkspaceModuleView {
    readonly name?: string;
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

export async function ensureSsgViewMetadataForPage(options: SsgViewMetadataOptions): Promise<void> {
    const pkgPath = path.join(options.workspaceRoot, 'package.json');
    const pkg = (await readJson<WorkspacePackageJson>(pkgPath)) ?? {};

    const webstir = pkg.webstir ?? {};
    const moduleConfig = webstir.module ?? {};
    const existingViews = Array.isArray(moduleConfig.views) ? [...moduleConfig.views] : [];

    const pageName = options.pageName;
    const isHome = pageName === 'home';
    const viewName = `${capitalize(pageName)}View`;
    const viewPath = isHome ? '/' : `/${pageName}`;
    const staticPaths = [viewPath];

    const existingIndex = existingViews.findIndex((view) => view?.name === viewName || view?.path === viewPath);
    const nextView: WorkspaceModuleView = {
        ...(existingIndex >= 0 ? existingViews[existingIndex] : {}),
        name: viewName,
        path: viewPath,
        renderMode: 'ssg',
        staticPaths
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
            module: {
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

