import path from 'node:path';
import { build as esbuild, type Metafile } from 'esbuild';
import { glob } from 'glob';
import { FOLDERS, FILES, EXTENSIONS } from '../core/constants.js';
import type { Builder, BuilderContext } from './types.js';
import { getPages } from '../core/pages.js';
import { ensureDir, pathExists, copy, remove, stat } from '../utils/fs.js';
import { updatePageManifest, updateSharedAssets, readSharedAssets } from '../assets/assetManifest.js';
import { createCompressedVariants } from '../assets/precompression.js';
import { shouldProcess } from '../utils/changedFile.js';
import { findPageFromChangedFile } from '../utils/pathMatch.js';

const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.js'];
const APP_ENTRY_BASENAME = 'app';

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

    await assertFeatureModulesPresent(config, context.enable);
    await compileAppTypeScript(config, isProduction);

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
    if (!isProduction || context.enable?.clientNav || context.enable?.search) {
        await copyRuntimeScripts(config, context.enable, isProduction);
    }
}

async function compileAppTypeScript(config: BuilderContext['config'], isProduction: boolean): Promise<void> {
    const appRoot = config.paths.src.app;
    if (!(await pathExists(appRoot))) {
        return;
    }

    if (isProduction) {
        const entryPoint = await resolveAppEntry(appRoot);
        if (!entryPoint) {
            return;
        }

        const outputDir = path.join(config.paths.dist.frontend, FOLDERS.app);
        await ensureDir(outputDir);

        const result = await esbuild({
            entryPoints: [entryPoint],
            outdir: outputDir,
            format: 'esm',
            target: 'es2020',
            platform: 'browser',
            minify: true,
            sourcemap: false,
            bundle: true,
            entryNames: 'app-[hash]',
            assetNames: 'assets/[name]-[hash]',
            metafile: true,
            logLevel: 'silent'
        });

        const fileName = await resolveAppBundleName(outputDir, entryPoint, result.metafile);
        if (!fileName) {
            throw new Error(`esbuild did not produce an app bundle for ${entryPoint}.`);
        }
        const absolutePath = path.join(outputDir, fileName);

        if (config.features.precompression) {
            await createCompressedVariants(absolutePath);
        } else {
            await Promise.all([
                remove(`${absolutePath}${EXTENSIONS.br}`).catch(() => undefined),
                remove(`${absolutePath}${EXTENSIONS.gz}`).catch(() => undefined)
            ]);
        }

        const existing = await readSharedAssets(config.paths.dist.frontend);
        const previousFile = existing?.js;
        if (previousFile && previousFile !== fileName) {
            const previousPath = path.join(outputDir, previousFile);
            await remove(previousPath).catch(() => undefined);
            await remove(`${previousPath}${EXTENSIONS.br}`).catch(() => undefined);
            await remove(`${previousPath}${EXTENSIONS.gz}`).catch(() => undefined);
        }

        await updateSharedAssets(config.paths.dist.frontend, shared => {
            shared.js = fileName;
        });

        return;
    }

    const entryPoints = (await glob('**/*.{ts,tsx}', { cwd: appRoot, nodir: true }))
        .filter((relativePath) => !relativePath.endsWith('.d.ts'))
        .map((relativePath) => path.join(appRoot, relativePath));
    if (entryPoints.length === 0) {
        return;
    }

    const outdir = isProduction
        ? path.join(config.paths.dist.frontend, FOLDERS.app)
        : path.join(config.paths.build.frontend, FOLDERS.app);
    await ensureDir(outdir);

    await esbuild({
        entryPoints,
        outdir,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        sourcemap: !isProduction,
        minify: isProduction,
        bundle: false,
        outbase: appRoot,
        logLevel: 'silent'
    });
}

async function buildForDevelopment(config: BuilderContext['config'], pageName: string, entryPoint: string): Promise<void> {
    const outputDir = path.join(config.paths.build.pages, pageName);
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
    const outputDir = path.join(config.paths.dist.pages, pageName);
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
        { name: FILES.hmrJs, copyToDist: false, required: !isProduction }
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

async function assertFeatureModulesPresent(config: BuilderContext['config'], enable: BuilderContext['enable']): Promise<void> {
    if (!enable) {
        return;
    }

    const missing: string[] = [];

    if (enable.clientNav === true) {
        const hasClientNav = await hasFeatureModule(config, 'client-nav');
        if (!hasClientNav) {
            missing.push('client-nav');
        }
    }

    if (enable.search === true) {
        const hasSearch = await hasFeatureModule(config, 'search');
        if (!hasSearch) {
            missing.push('search');
        }
    }

    if (enable.contentNav === true) {
        const hasContentNav = await hasFeatureModule(config, 'content-nav');
        if (!hasContentNav) {
            missing.push('content-nav');
        }
    }

    if (missing.length === 0) {
        return;
    }

    const expected = missing
        .map((name) => `src/frontend/app/scripts/features/${name}.ts`)
        .join(', ');
    throw new Error(
        `Enabled feature module(s) missing: ${missing.join(', ')}. Run 'webstir enable <feature>' to scaffold them (expected: ${expected}).`
    );
}

async function hasFeatureModule(config: BuilderContext['config'], name: string): Promise<boolean> {
    const root = path.join(config.paths.src.app, 'scripts', 'features');
    return await pathExists(path.join(root, `${name}${EXTENSIONS.ts}`))
        || await pathExists(path.join(root, `${name}${EXTENSIONS.js}`));
}

async function resolveAppBundleName(
    outputDir: string,
    entryPoint: string,
    metafile?: Metafile
): Promise<string | null> {
    const outputs = metafile?.outputs ?? {};
    const outputEntries = Object.entries(outputs) as Array<[string, Metafile['outputs'][string]]>;
    const entryOutput = outputEntries.find(([, meta]) => {
        if (!meta.entryPoint) {
            return false;
        }
        return path.resolve(meta.entryPoint) === path.resolve(entryPoint);
    });

    if (entryOutput) {
        return path.basename(entryOutput[0]);
    }

    const matches = await glob('app-*.js', { cwd: outputDir, nodir: true });
    if (matches.length === 0) {
        return null;
    }

    if (matches.length === 1) {
        return matches[0] ?? null;
    }

    let latest: { name: string; time: number } | null = null;
    for (const name of matches) {
        const info = await stat(path.join(outputDir, name));
        const time = info.mtimeMs;
        if (!latest || time > latest.time) {
            latest = { name, time };
        }
    }

    return latest?.name ?? matches[0] ?? null;
}

async function resolveAppEntry(appRoot: string): Promise<string | null> {
    const candidates = [
        `${APP_ENTRY_BASENAME}${EXTENSIONS.ts}`,
        `${APP_ENTRY_BASENAME}.tsx`,
        `${APP_ENTRY_BASENAME}${EXTENSIONS.js}`,
        `${APP_ENTRY_BASENAME}.jsx`
    ];

    for (const candidate of candidates) {
        const fullPath = path.join(appRoot, candidate);
        if (await pathExists(fullPath)) {
            return fullPath;
        }
    }

    return null;
}
