import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadProviderOrSkip(t) {
  try {
    const mod = await import('../dist/index.js');
    return mod.frontendProvider;
  } catch (err) {
    console.warn('[frontend-tests] Skipping provider integration: optional dependency unavailable:', err?.message ?? err);
    t?.diagnostic?.('skip: missing optional dependency');
    return null;
  }
}

async function createWorkspaceWithContent() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-content-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  const contentDir = path.join(root, 'src', 'frontend', 'content');
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(contentDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    '<!DOCTYPE html><html><head><title>My Site</title></head><body><main></main></body></html>',
    'utf8'
  );
  await fs.writeFile(path.join(appDir, 'app.css'), 'body{font-family:sans-serif;}', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.html'), '<head></head><main><section>Home</section></main>', 'utf8');

  await fs.writeFile(
    path.join(contentDir, 'readme.md'),
    [
      '---',
      'title: Content pipeline',
      'description: How it works',
      'order: 1',
      '---',
      '',
      '# Content pipeline',
      '',
      'Hello from markdown.'
    ].join('\n'),
    'utf8'
  );

  return root;
}

test('content builder strips frontmatter and injects app styles', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspaceWithContent();

  try {
    await frontendProvider.build({ workspaceRoot: workspace, env: { WEBSTIR_MODULE_MODE: 'build' }, incremental: false });

    const htmlPath = path.join(workspace, 'build', 'frontend', 'pages', 'docs', 'readme', 'index.html');
    assert.equal(fssync.existsSync(htmlPath), true, `expected ${htmlPath}`);

    const html = await fs.readFile(htmlPath, 'utf8');
    assert.ok(!html.includes('title: Content pipeline'), 'frontmatter should not be rendered');
    assert.ok(html.includes('<article>'), 'expected markdown wrapped in <article>');
    assert.ok(html.includes('href="/app/app.css"'), 'expected app.css link injected');

    const navPath = path.join(workspace, 'build', 'frontend', 'docs-nav.json');
    const searchPath = path.join(workspace, 'build', 'frontend', 'docs-search.json');
    assert.equal(fssync.existsSync(navPath), true, `expected ${navPath}`);
    assert.equal(fssync.existsSync(searchPath), true, `expected ${searchPath}`);

    const nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    assert.ok(Array.isArray(nav) && nav.length > 0, 'expected docs-nav.json to contain entries');
    assert.ok(nav.some((entry) => entry.path === '/docs/readme/'), 'expected docs-nav.json to include /docs/readme/');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
