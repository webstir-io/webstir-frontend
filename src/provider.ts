import path from 'node:path';
import fs from 'node:fs';

import { glob } from 'glob';
import type {
    ModuleAsset,
    ModuleArtifact,
    ModuleBuildOptions,
    ModuleBuildResult,
    ModuleDiagnostic,
    ModuleProvider,
    ResolvedModuleWorkspace
} from '@webstir-io/module-contract';

import packageJson from '../package.json' with { type: 'json' };
import { runPipeline } from './pipeline.js';
import type { PipelineMode } from './pipeline.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import type { FrontendConfig } from './types.js';
import { readJson } from './utils/fs.js';
import { applySsgRouting, assertNoSsgRoutes, generateSsgViewData } from './modes/ssg/index.js';

interface PackageJson {
    readonly name: string;
    readonly version: string;
    readonly engines?: {
        readonly node?: string;
    };
}

const pkg = packageJson as PackageJson;

function resolveWorkspacePaths(workspaceRoot: string): ResolvedModuleWorkspace {
    return {
        sourceRoot: path.join(workspaceRoot, 'src', 'frontend'),
        buildRoot: path.join(workspaceRoot, 'build', 'frontend'),
        testsRoot: path.join(workspaceRoot, 'src', 'frontend', 'tests')
    };
}

async function buildModule(options: ModuleBuildOptions): Promise<ModuleBuildResult> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    const mode = normalizeMode(options.env?.WEBSTIR_MODULE_MODE);
    const workspaceMode = await readWorkspaceMode(options.workspaceRoot);
    const frontendMode = normalizeFrontendMode(options.env?.WEBSTIR_FRONTEND_MODE);
    const shouldRunSsgPublish =
        mode === 'publish' && (frontendMode === 'ssg' || (frontendMode === undefined && workspaceMode.mode === 'ssg'));

    if (shouldRunSsgPublish) {
        await assertNoSsgRoutes(config.paths.workspace);
    }
    await runPipeline(config, mode, { changedFile: undefined, enable: workspaceMode.enable });

    if (shouldRunSsgPublish) {
        await generateSsgViewData(config);
        await applySsgRouting(config);
    }

    const artifacts = await collectArtifacts(config);
    const manifest = createManifest(config, artifacts, workspaceMode.mode, workspaceMode.isSsg);

    return {
        artifacts,
        manifest
    };
}

function normalizeMode(rawMode: unknown): PipelineMode {
    if (typeof rawMode !== 'string') {
        return 'build';
    }

    return rawMode.toLowerCase() === 'publish' ? 'publish' : 'build';
}

async function getScaffoldAssets(): Promise<readonly ModuleAsset[]> {
    return [];
}

async function collectArtifacts(config: FrontendConfig): Promise<ModuleArtifact[]> {
    const buildRoot = config.paths.build.frontend;
    const matches = await glob('**/*', {
        cwd: buildRoot,
        nodir: true,
        dot: false
    });

    return matches.map<ModuleArtifact>((relative) => {
        const absolutePath = path.join(buildRoot, relative);
        const ext = path.extname(relative).toLowerCase();
        const artifactType = ext === '.js' || ext === '.mjs' ? 'bundle' : 'asset';

        return {
            path: absolutePath,
            type: artifactType
        };
    });
}

interface WorkspaceEnableFlags {
    readonly spa?: boolean;
    readonly clientNav?: boolean;
    readonly backend?: boolean;
    readonly search?: boolean;
}

interface WorkspacePackageJson {
    readonly webstir?: {
        readonly mode?: string;
        readonly enable?: WorkspaceEnableFlags;
        readonly moduleManifest?: {
            readonly views?: ReadonlyArray<{
                readonly renderMode?: string;
            }>;
        };
    };
}

function createManifest(
    config: FrontendConfig,
    assets: readonly ModuleArtifact[],
    workspaceMode?: string,
    isSsgWorkspace?: boolean
) {
    const entryPoints: string[] = [];
    const staticAssets: string[] = [];
    const diagnostics: ModuleDiagnostic[] = [];

    const normalizedMode = workspaceMode?.toLowerCase();
    const isSsg = isSsgWorkspace || normalizedMode === 'ssg';

    for (const asset of assets) {
        const relativePath = path.relative(config.paths.build.frontend, asset.path);
        const ext = path.extname(relativePath).toLowerCase();

        if (ext === '.js' || ext === '.mjs') {
            entryPoints.push(relativePath);
        } else if (ext) {
            staticAssets.push(relativePath);
        }
    }

    if (entryPoints.length === 0) {
        const fallback = path.join(config.paths.build.app, 'index.js');
        if (fs.existsSync(fallback)) {
            entryPoints.push(path.relative(config.paths.build.frontend, fallback));
        } else if (!isSsg) {
            diagnostics.push({
                severity: 'warn',
                message: 'No JavaScript entry points found under build/frontend.'
            });
        }
    }

    return {
        entryPoints,
        staticAssets,
        diagnostics
    };
}

async function readWorkspaceMode(workspaceRoot: string): Promise<{ mode?: string; isSsg: boolean; enable?: WorkspaceEnableFlags }> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJson>(pkgPath);
    const mode = pkg?.webstir?.mode;
    const normalizedMode = typeof mode === 'string' ? mode.toLowerCase() : undefined;
    const views = pkg?.webstir?.moduleManifest?.views;
    const hasSsgView = Array.isArray(views) && views.some(view => view.renderMode?.toLowerCase() === 'ssg');
    return {
        mode,
        isSsg: normalizedMode === 'ssg' || hasSsgView,
        enable: pkg?.webstir?.enable
    };
}

function normalizeFrontendMode(value: unknown): 'bundle' | 'ssg' | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === 'ssg'
        ? 'ssg'
        : normalized === 'bundle'
            ? 'bundle'
            : undefined;
}

export const frontendProvider: ModuleProvider = {
    metadata: {
        id: pkg.name ?? '@webstir-io/webstir-frontend',
        kind: 'frontend',
        version: pkg.version ?? '0.0.0',
        compatibility: {
            minCliVersion: '0.1.0',
            nodeRange: pkg.engines?.node ?? '>=20.18.1'
        }
    },
    resolveWorkspace(options) {
        return resolveWorkspacePaths(options.workspaceRoot);
    },
    async build(options) {
        return await buildModule(options);
    },
    async getScaffoldAssets() {
        return await getScaffoldAssets();
    }
};
