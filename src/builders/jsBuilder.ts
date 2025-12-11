import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { FOLDERS, FILES, EXTENSIONS } from '../core/constants.js';
import type { Builder, BuilderContext } from './types.js';
import { getPages } from '../core/pages.js';
import { ensureDir, pathExists, copy, remove } from '../utils/fs.js';
import { updatePageManifest } from '../assets/assetManifest.js';
import { createCompressedVariants } from '../assets/precompression.js';
import { shouldProcess } from '../utils/changedFile.js';
import { findPageFromChangedFile } from '../utils/pathMatch.js';

const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.js'];

export function createJavaScriptBuilder(context: BuilderContext): Builder {
    return {
        name: 'javascript',
        async build(): Promise<void> {
            await bundleJavaScript(context, false);
        },
        async publish(): Promise<void> {
            await bundleJavaScript(context, true);
        }
    };
}

async function bundleJavaScript(context: BuilderContext, isProduction: boolean): Promise<void> {
    const { config } = context;
    if (!shouldProcess(context, [
        {
            directory: config.paths.src.frontend,
            extensions: [EXTENSIONS.ts, EXTENSIONS.js, '.tsx', '.jsx']
        }
    ])) {
        return;
    }
    const targetPage = findPageFromChangedFile(context.changedFile, config.paths.src.pages);
    const pages = await getPages(config.paths.src.pages);
    let builtAny = false;

    for (const page of pages) {
        if (targetPage && page.name !== targetPage) {
            continue;
        }
        const entryPoint = await resolveEntryPoint(page.directory);
        if (!entryPoint) {
            continue;
        }

        builtAny = true;

        if (isProduction) {
            await buildForProduction(config, page.name, entryPoint);
        } else {
            await buildForDevelopment(config, page.name, entryPoint);
        }
    }

    // Always copy dev runtime scripts in dev builds to support HMR/refresh even when no page JS exists.
    if (!isProduction || context.enable?.seamlessNav) {
        await copyRuntimeScripts(config, context.enable, isProduction);
    }
}

async function buildForDevelopment(config: BuilderContext['config'], pageName: string, entryPoint: string): Promise<void> {
    const outputDir = path.join(config.paths.build.frontend, FOLDERS.pages, pageName);
    await ensureDir(outputDir);
    const outfile = path.join(outputDir, `${FILES.index}${EXTENSIONS.js}`);

    await esbuild({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        sourcemap: true,
        outfile,
        logLevel: 'silent'
    });
}

async function buildForProduction(config: BuilderContext['config'], pageName: string, entryPoint: string): Promise<void> {
    const outputDir = path.join(config.paths.dist.frontend, FOLDERS.pages, pageName);
    await ensureDir(outputDir);

    const result = await esbuild({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        minify: true,
        sourcemap: false,
        outdir: outputDir,
        entryNames: `${FILES.index}-[hash]`,
        assetNames: 'assets/[name]-[hash]',
        metafile: true,
        logLevel: 'silent'
    });

    const outputs = result.metafile?.outputs ?? {};
    const scriptPath = Object.keys(outputs).find((file) => file.endsWith('.js'));
    if (!scriptPath) {
        throw new Error(`esbuild did not produce a JavaScript bundle for page '${pageName}'.`);
    }

    const fileName = path.basename(scriptPath);
    const absolutePath = path.join(outputDir, fileName);
    if (config.features.precompression) {
        await createCompressedVariants(absolutePath);
    } else {
        await Promise.all([
            remove(`${absolutePath}${EXTENSIONS.br}`).catch(() => undefined),
            remove(`${absolutePath}${EXTENSIONS.gz}`).catch(() => undefined)
        ]);
    }
    await updatePageManifest(outputDir, pageName, (manifest) => {
        manifest.js = fileName;
    });
}

async function copyRuntimeScripts(
    config: BuilderContext['config'],
    enable: BuilderContext['enable'],
    isProduction: boolean
): Promise<void> {
    const scripts = [
        // Always copy dev runtime in dev builds to support live reload, even if no page JS exists.
        { name: FILES.refreshJs, copyToDist: false, required: !isProduction },
        { name: FILES.hmrJs, copyToDist: false, required: !isProduction },
        { name: 'seamlessNav.js', copyToDist: true, required: enable?.seamlessNav === true }
    ];

    for (const script of scripts) {
        if (!script.required) {
            continue;
        }

        const source = path.join(config.paths.src.app, script.name);
        if (!(await pathExists(source))) {
            continue;
        }

        const buildDestination = path.join(config.paths.build.frontend, script.name);
        await ensureDir(path.dirname(buildDestination));
        await copy(source, buildDestination);

        if (isProduction && script.copyToDist) {
            const distDestination = path.join(config.paths.dist.frontend, script.name);
            await ensureDir(path.dirname(distDestination));
            await copy(source, distDestination);
        }
    }
}

async function resolveEntryPoint(pageDirectory: string): Promise<string | null> {
    for (const extension of ENTRY_EXTENSIONS) {
        const candidate = path.join(pageDirectory, `${FILES.index}${extension}`);
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
}
