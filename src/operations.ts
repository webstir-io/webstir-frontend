import type { AddPageCommandOptions, FrontendCommandOptions } from './types.js';
import { runPipeline } from './pipeline.js';
import { createPageScaffold } from './html/pageScaffold.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import { applySsgRouting } from './ssg.js';
import { generateSsgViewData } from './ssgViews.js';
import { ensureSsgViewMetadataForPage } from './ssgMetadata.js';

export async function runBuild(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);

    console.info('[webstir-frontend] Running build pipeline...');
    await runPipeline(config, 'build', { changedFile: options.changedFile });
    console.info('[webstir-frontend] Build pipeline completed.');
}

export async function runPublish(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);

    const modeLabel = options.publishMode === 'ssg' ? 'SSG publish' : 'publish';
    console.info(`[webstir-frontend] Running ${modeLabel} pipeline...`);
    await runPipeline(config, 'publish');
    if (options.publishMode === 'ssg') {
        await generateSsgViewData(config);
        await applySsgRouting(config);
    }
    console.info(`[webstir-frontend] ${modeLabel} pipeline completed.`);
}

export async function runRebuild(options: FrontendCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);

    console.info('[webstir-frontend] Running rebuild pipeline...');
    await runPipeline(config, 'build', { changedFile: options.changedFile });
    console.info('[webstir-frontend] Rebuild pipeline completed.');
}

export async function runAddPage(options: AddPageCommandOptions): Promise<void> {
    const config = await prepareWorkspaceConfig(options.workspaceRoot);
    console.info('[webstir-frontend] Creating page scaffold...');
    await createPageScaffold({
        workspaceRoot: options.workspaceRoot,
        pageName: options.pageName,
        paths: {
            pages: config.paths.src.pages,
            app: config.paths.src.app
        }
    });
    if (options.ssg) {
        await ensureSsgViewMetadataForPage({
            workspaceRoot: options.workspaceRoot,
            pageName: options.pageName
        });
    }
    console.info('[webstir-frontend] Page scaffold created.');
}
