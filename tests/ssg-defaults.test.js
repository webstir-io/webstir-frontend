import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applySsgRouting, generateSsgViewData } from '../dist/modes/ssg/index.js';

async function createWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-ssg-defaults-'));

    const distFrontend = path.join(root, 'dist', 'frontend');
    const distPages = path.join(distFrontend, 'pages');
    await fs.mkdir(path.join(distPages, 'home'), { recursive: true });
    await fs.mkdir(path.join(distPages, 'about'), { recursive: true });

    await fs.writeFile(path.join(distPages, 'home', 'index.html'), '<!doctype html><main>home</main>', 'utf8');
    await fs.writeFile(path.join(distPages, 'about', 'index.html'), '<!doctype html><main>about</main>', 'utf8');

    const pkg = {
        name: 'webstir-project',
        version: '1.0.0',
        webstir: {
            mode: 'ssg',
            moduleManifest: {
                views: [
                    {
                        name: 'AboutView',
                        path: '/about',
                        staticPaths: ['/about', '/about/team']
                    }
                ]
            }
        }
    };

    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

    return root;
}

test('ssg workspace defaults views to renderMode=ssg when omitted', async () => {
    const workspace = await createWorkspace();
    const distFrontend = path.join(workspace, 'dist', 'frontend');
    const distPages = path.join(distFrontend, 'pages');

    try {
        await applySsgRouting({
            version: 1,
            paths: {
                workspace,
                dist: {
                    root: path.join(workspace, 'dist'),
                    frontend: distFrontend,
                    app: path.join(distFrontend, 'app'),
                    pages: distPages,
                    content: path.join(distPages, 'docs'),
                    images: path.join(distFrontend, 'images'),
                    fonts: path.join(distFrontend, 'fonts'),
                    media: path.join(distFrontend, 'media')
                },
                build: {
                    root: path.join(workspace, 'build'),
                    frontend: path.join(workspace, 'build', 'frontend'),
                    app: path.join(workspace, 'build', 'frontend', 'app'),
                    pages: path.join(workspace, 'build', 'frontend', 'pages'),
                    content: path.join(workspace, 'build', 'frontend', 'pages', 'docs'),
                    images: path.join(workspace, 'build', 'frontend', 'images'),
                    fonts: path.join(workspace, 'build', 'frontend', 'fonts'),
                    media: path.join(workspace, 'build', 'frontend', 'media')
                },
                src: {
                    root: path.join(workspace, 'src'),
                    frontend: path.join(workspace, 'src', 'frontend'),
                    app: path.join(workspace, 'src', 'frontend', 'app'),
                    pages: path.join(workspace, 'src', 'frontend', 'pages'),
                    content: path.join(workspace, 'src', 'frontend', 'content'),
                    images: path.join(workspace, 'src', 'frontend', 'images'),
                    fonts: path.join(workspace, 'src', 'frontend', 'fonts'),
                    media: path.join(workspace, 'src', 'frontend', 'media')
                }
            },
            features: {
                htmlSecurity: true,
                imageOptimization: true,
                precompression: true
            }
        });

        const nestedAlias = path.join(distFrontend, 'about', 'team', 'index.html');
        assert.equal(fssync.existsSync(nestedAlias), true, `expected nested alias at ${nestedAlias}`);
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test('ssg workspace defaults staticPaths to [path] for view data', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-ssg-default-paths-'));
    const distFrontend = path.join(workspace, 'dist', 'frontend');
    const distPages = path.join(distFrontend, 'pages');
    const buildBackend = path.join(workspace, 'build', 'backend');

    await fs.mkdir(path.join(distPages, 'about'), { recursive: true });
    await fs.writeFile(path.join(distPages, 'about', 'index.html'), '<!doctype html><main>about</main>', 'utf8');

    await fs.mkdir(buildBackend, { recursive: true });
    await fs.writeFile(
        path.join(buildBackend, 'module.mjs'),
        [
            "export const module = {",
            "  views: [",
            "    {",
            "      definition: { name: 'AboutView', path: '/about' },",
            "      load: async () => ({ title: 'about' })",
            "    }",
            "  ]",
            "};"
        ].join('\n'),
        'utf8'
    );

    await fs.writeFile(
        path.join(workspace, 'package.json'),
        JSON.stringify(
            {
                name: 'webstir-project',
                version: '1.0.0',
                webstir: {
                    mode: 'ssg',
                    moduleManifest: {
                        views: [
                            {
                                name: 'AboutView',
                                path: '/about'
                            }
                        ]
                    }
                }
            },
            null,
            2
        ),
        'utf8'
    );

    const config = {
        version: 1,
        paths: {
            workspace,
            dist: {
                root: path.join(workspace, 'dist'),
                frontend: distFrontend,
                app: path.join(distFrontend, 'app'),
                pages: distPages,
                content: path.join(distPages, 'docs'),
                images: path.join(distFrontend, 'images'),
                fonts: path.join(distFrontend, 'fonts'),
                media: path.join(distFrontend, 'media')
            },
            build: {
                root: path.join(workspace, 'build'),
                frontend: path.join(workspace, 'build', 'frontend'),
                app: path.join(workspace, 'build', 'frontend', 'app'),
                pages: path.join(workspace, 'build', 'frontend', 'pages'),
                content: path.join(workspace, 'build', 'frontend', 'pages', 'docs'),
                images: path.join(workspace, 'build', 'frontend', 'images'),
                fonts: path.join(workspace, 'build', 'frontend', 'fonts'),
                media: path.join(workspace, 'build', 'frontend', 'media')
            },
            src: {
                root: path.join(workspace, 'src'),
                frontend: path.join(workspace, 'src', 'frontend'),
                app: path.join(workspace, 'src', 'frontend', 'app'),
                pages: path.join(workspace, 'src', 'frontend', 'pages'),
                content: path.join(workspace, 'src', 'frontend', 'content'),
                images: path.join(workspace, 'src', 'frontend', 'images'),
                fonts: path.join(workspace, 'src', 'frontend', 'fonts'),
                media: path.join(workspace, 'src', 'frontend', 'media')
            }
        },
        features: {
            htmlSecurity: true,
            imageOptimization: true,
            precompression: true
        }
    };

    try {
        await generateSsgViewData(config);
        const dataPath = path.join(distPages, 'about', 'view-data.json');
        assert.equal(fssync.existsSync(dataPath), true, `expected view data at ${dataPath}`);
        const raw = await fs.readFile(dataPath, 'utf8');
        const parsed = JSON.parse(raw);
        assert.equal(Array.isArray(parsed), true);
        assert.equal(parsed[0]?.path, '/about');
        assert.deepEqual(parsed[0]?.data, { title: 'about' });
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});
