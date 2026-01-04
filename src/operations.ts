import { readdir } from 'node:fs/promises';
import type { AddPageCommandOptions, EnableFlags, FrontendCommandOptions } from './types.js';
import { runPipeline } from './pipeline.js';
import { createPageScaffold } from './html/pageScaffold.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import {
    applySsgRouting,
    assertNoSsgRoutes,
    ensureSsgViewMetadataForPage,
    generateSsgViewData
} from './modes/ssg/index.js';
import path from 'node:path';
import { FOLDERS } from './core/constants.js';
import { pathExists, readJson, remove } from './utils/fs.js';

export async function runBuild(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    const enable = await readWorkspaceEnableFlags(options.workspaceRoot);

    console.info('[webstir-frontend] Running build pipeline...');
    await runPipeline(config, 'build', { changedFile: options.changedFile, enable });
    console.info('[webstir-frontend] Build pipeline completed.');
}

export async function runPublish(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    const enable = await readWorkspaceEnableFlags(options.workspaceRoot);
    const publishConfig = options.publishMode === 'ssg' ? applySsgPublishLayout(config) : config;

    const modeLabel = options.publishMode === 'ssg' ? 'SSG publish' : 'publish';
    console.info(`[webstir-frontend] Running ${modeLabel} pipeline...`);

    if (options.publishMode === 'ssg') {
        await assertNoSsgRoutes(config.paths.workspace);
    }

    await runPipeline(publishConfig, 'publish', { enable });
    if (options.publishMode === 'ssg') {
        await generateSsgViewData(publishConfig);
        await applySsgRouting(publishConfig);
        await removeLegacyPagesFolder(publishConfig);
    }
    console.info(`[webstir-frontend] ${modeLabel} pipeline completed.`);
}

export async function runRebuild(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    const enable = await readWorkspaceEnableFlags(options.workspaceRoot);

    console.info('[webstir-frontend] Running rebuild pipeline...');
    await runPipeline(config, 'build', { changedFile: options.changedFile, enable });
    console.info('[webstir-frontend] Rebuild pipeline completed.');
}

export async function runAddPage(options: AddPageCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    console.info('[webstir-frontend] Creating page scaffold...');

    const isSsgWorkspace = await detectSsgWorkspace(options.workspaceRoot);
    const effectiveSsg = options.ssg ?? isSsgWorkspace;
    await createPageScaffold({
        workspaceRoot: options.workspaceRoot,
        pageName: options.pageName,
        mode: effectiveSsg ? 'ssg' : 'standard',
        paths: {
            pages: config.paths.src.pages,
            app: config.paths.src.app
        }
    });
    if (effectiveSsg) {
        await ensureSsgViewMetadataForPage({
            workspaceRoot: options.workspaceRoot,
            pageName: options.pageName
        });
    }
    console.info('[webstir-frontend] Page scaffold created.');
}

interface WorkspacePackageJsonMode {
    readonly webstir?: {
        readonly mode?: string;
    };
}

async function detectSsgWorkspace(workspaceRoot: string): Promise<boolean> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJsonMode>(pkgPath);
    const mode = pkg?.webstir?.mode;
    return typeof mode === 'string' && mode.toLowerCase() === 'ssg';
}

function applySsgPublishLayout(config: import('./types.js').FrontendConfig): import('./types.js').FrontendConfig {
    const distFrontend = config.paths.dist.frontend;
    const distPages = distFrontend;
    const distContent = path.join(distFrontend, 'docs');

    return {
        ...config,
        paths: {
            ...config.paths,
            dist: {
                ...config.paths.dist,
                pages: distPages,
                content: distContent
            }
        }
    };
}

interface WorkspacePackageJsonEnable {
    readonly webstir?: {
        readonly enable?: EnableFlags;
    };
}

async function readWorkspaceEnableFlags(workspaceRoot: string): Promise<EnableFlags | undefined> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = await readJson<WorkspacePackageJsonEnable>(pkgPath);
    return pkg?.webstir?.enable;
}

async function removeLegacyPagesFolder(config: import('./types.js').FrontendConfig): Promise<void> {
    const legacyPagesRoot = path.join(config.paths.dist.frontend, FOLDERS.pages);
    if (legacyPagesRoot === config.paths.dist.pages) {
        return;
    }

    if (!(await pathExists(legacyPagesRoot))) {
        return;
    }

    const entries = await readdir(legacyPagesRoot);
    if (entries.length > 0) {
        return;
    }

    await remove(legacyPagesRoot);
}
