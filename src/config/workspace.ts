import fs from 'node:fs';
import path from 'path';
import type { FrontendConfig, FrontendFeatureFlags } from '../types.js';
import { FOLDERS } from '../core/constants.js';
import { frontendFeatureFlagsSchema } from './schema.js';

const DEFAULT_FEATURE_FLAGS: FrontendFeatureFlags = {
    htmlSecurity: true,
    imageOptimization: true,
    precompression: true
};

export function buildConfig(workspaceRoot: string): FrontendConfig {
    const srcRoot = path.join(workspaceRoot, FOLDERS.src);
    const frontendRoot = path.join(srcRoot, FOLDERS.frontend);
    const buildRoot = path.join(workspaceRoot, FOLDERS.build);
    const distRoot = path.join(workspaceRoot, FOLDERS.dist);

    const buildFrontend = path.join(buildRoot, FOLDERS.frontend);
    const distFrontend = path.join(distRoot, FOLDERS.frontend);
    const srcContentRoot = resolveContentRoot(workspaceRoot, frontendRoot);

    return {
        version: 1,
        paths: {
            workspace: workspaceRoot,
            src: {
                root: srcRoot,
                frontend: frontendRoot,
                app: path.join(frontendRoot, FOLDERS.app),
                pages: path.join(frontendRoot, FOLDERS.pages),
                content: srcContentRoot,
                images: path.join(frontendRoot, FOLDERS.images),
                fonts: path.join(frontendRoot, FOLDERS.fonts),
                media: path.join(frontendRoot, FOLDERS.media)
            },
            build: {
                root: buildRoot,
                frontend: buildFrontend,
                app: path.join(buildFrontend, FOLDERS.app),
                pages: path.join(buildFrontend, FOLDERS.pages),
                content: path.join(buildFrontend, FOLDERS.pages, 'docs'),
                images: path.join(buildFrontend, FOLDERS.images),
                fonts: path.join(buildFrontend, FOLDERS.fonts),
                media: path.join(buildFrontend, FOLDERS.media)
            },
            dist: {
                root: distRoot,
                frontend: distFrontend,
                app: path.join(distFrontend, FOLDERS.app),
                pages: path.join(distFrontend, FOLDERS.pages),
                content: path.join(distFrontend, FOLDERS.pages, 'docs'),
                images: path.join(distFrontend, FOLDERS.images),
                fonts: path.join(distFrontend, FOLDERS.fonts),
                media: path.join(distFrontend, FOLDERS.media)
            }
        },
        features: loadFeatureFlags(frontendRoot)
    };
}

function resolveContentRoot(workspaceRoot: string, frontendRoot: string): string {
    const defaultContentRoot = path.join(frontendRoot, 'content');
    const configPath = path.join(frontendRoot, 'frontend.config.json');
    if (!fs.existsSync(configPath)) {
        return defaultContentRoot;
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const override = extractContentRoot(parsed);

        if (override === undefined) {
            return defaultContentRoot;
        }

        if (typeof override !== 'string') {
            throw new Error('Expected contentRoot to be a string when specified.');
        }

        const trimmed = override.trim();
        if (!trimmed) {
            return defaultContentRoot;
        }

        if (path.isAbsolute(trimmed)) {
            return trimmed;
        }

        return path.join(workspaceRoot, trimmed);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read frontend content root from ${configPath}: ${message}`);
    }
}

function extractContentRoot(value: unknown): unknown {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const container = value as Record<string, unknown>;

    if ('paths' in container && container.paths && typeof container.paths === 'object') {
        const pathsContainer = container.paths as Record<string, unknown>;
        if ('contentRoot' in pathsContainer) {
            return pathsContainer.contentRoot;
        }
    }

    if ('contentRoot' in container) {
        return container.contentRoot;
    }

    return undefined;
}

function loadFeatureFlags(frontendRoot: string): FrontendFeatureFlags {
    const configPath = path.join(frontendRoot, 'frontend.config.json');
    if (!fs.existsSync(configPath)) {
        return DEFAULT_FEATURE_FLAGS;
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        const overridesSource = extractOverrideSource(parsed);
        const overrides = frontendFeatureFlagsSchema.parse(overridesSource);
        return {
            htmlSecurity: overrides.htmlSecurity,
            imageOptimization: overrides.imageOptimization,
            precompression: overrides.precompression
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read frontend feature flags from ${configPath}: ${message}`);
    }
}

function extractOverrideSource(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && 'features' in (value as Record<string, unknown>)) {
        const container = (value as Record<string, unknown>).features;
        if (container && typeof container === 'object') {
            return container as Record<string, unknown>;
        }
    }

    return (value && typeof value === 'object') ? value as Record<string, unknown> : {};
}
