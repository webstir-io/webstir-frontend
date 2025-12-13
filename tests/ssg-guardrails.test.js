import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPublish } from '../dist/index.js';

async function createWorkspace(pkg) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-ssg-guard-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    return root;
}

test('ssg publish rejects route-level renderMode/staticPaths/ssg metadata', async () => {
    const workspace = await createWorkspace({
        name: 'webstir-project',
        version: '1.0.0',
        webstir: {
            moduleManifest: {
                routes: [
                    {
                        name: 'ApiRoute',
                        method: 'GET',
                        path: '/api/route',
                        renderMode: 'ssg'
                    }
                ]
            }
        }
    });

    try {
        await assert.rejects(
            runPublish({ workspaceRoot: workspace, publishMode: 'ssg' }),
            /SSG publish expects SSG metadata under `webstir\.moduleManifest\.views`/i
        );
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test('ssg publish rejects route-level staticPaths without renderMode', async () => {
    const workspace = await createWorkspace({
        name: 'webstir-project',
        version: '1.0.0',
        webstir: {
            moduleManifest: {
                routes: [
                    {
                        name: 'ApiRoute',
                        method: 'GET',
                        path: '/api/route',
                        staticPaths: ['/']
                    }
                ]
            }
        }
    });

    try {
        await assert.rejects(
            runPublish({ workspaceRoot: workspace, publishMode: 'ssg' }),
            /SSG publish expects SSG metadata under `webstir\.moduleManifest\.views`/i
        );
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});
