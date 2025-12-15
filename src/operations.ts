import type { AddPageCommandOptions, EnableFlags, FrontendCommandOptions } from './types.js';
import { runPipeline } from './pipeline.js';
import { createPageScaffold } from './html/pageScaffold.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import { applySsgRouting } from './ssg.js';
import { generateSsgViewData } from './ssgViews.js';
import { ensureSsgViewMetadataForPage } from './ssgMetadata.js';
import { assertNoSsgRoutes } from './ssgValidation.js';
import path from 'node:path';
import { readJson } from './utils/fs.js';

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

    const modeLabel = options.publishMode === 'ssg' ? 'SSG publish' : 'publish';
    console.info(`[webstir-frontend] Running ${modeLabel} pipeline...`);

    if (options.publishMode === 'ssg') {
        await assertNoSsgRoutes(config.paths.workspace);
    }

    await runPipeline(config, 'publish', { enable });
    if (options.publishMode === 'ssg') {
        await generateSsgViewData(config);
        await applySsgRouting(config);
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
