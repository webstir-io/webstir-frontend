import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAddPage } from '../dist/index.js';

async function createWorkspace(pkg) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-add-page-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    return root;
}

test('add-page defaults to ssg scaffold when webstir.mode=ssg', async () => {
    const workspace = await createWorkspace({
        name: 'webstir-project',
        version: '1.0.0',
        webstir: { mode: 'ssg' }
    });

    try {
        await runAddPage({ workspaceRoot: workspace, pageName: 'about' });

        const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
        const htmlPath = path.join(pageDir, 'index.html');
        const cssPath = path.join(pageDir, 'index.css');
        const tsPath = path.join(pageDir, 'index.ts');

        assert.equal(fssync.existsSync(htmlPath), true);
        assert.equal(fssync.existsSync(cssPath), true);
        assert.equal(fssync.existsSync(tsPath), false);

        const html = await fs.readFile(htmlPath, 'utf8');
        assert.ok(!html.includes('<script type="module"'), 'ssg scaffold should not include module script tag');
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

test('add-page defaults to standard scaffold when webstir.mode is not ssg', async () => {
    const workspace = await createWorkspace({
        name: 'webstir-project',
        version: '1.0.0'
    });

    try {
        await runAddPage({ workspaceRoot: workspace, pageName: 'about' });

        const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'about');
        const htmlPath = path.join(pageDir, 'index.html');
        const tsPath = path.join(pageDir, 'index.ts');

        assert.equal(fssync.existsSync(htmlPath), true);
        assert.equal(fssync.existsSync(tsPath), true);

        const html = await fs.readFile(htmlPath, 'utf8');
        assert.ok(html.includes('<script type="module"'), 'standard scaffold should include module script tag');
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});

