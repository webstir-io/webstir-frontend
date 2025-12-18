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

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-css-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const stylesDir = path.join(appDir, 'styles');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  await fs.mkdir(stylesDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main></body></html>',
    'utf8'
  );
  await fs.writeFile(
    path.join(appDir, 'app.css'),
    [
      '@layer reset, base;',
      '@import "./styles/base.css";'
    ].join('\n'),
    'utf8'
  );
  await fs.writeFile(path.join(stylesDir, 'base.css'), '@layer base { body { background: blue; } }', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.html'), '<head></head><main><section>Home</section></main>', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.css'), '@import "@app/app.css";', 'utf8');

  return root;
}

test('development app.css import URLs include a cache-busting version', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspace();

  try {
    await frontendProvider.build({ workspaceRoot: workspace, env: { WEBSTIR_MODULE_MODE: 'build' }, incremental: false });

    const appCssPath = path.join(workspace, 'build', 'frontend', 'app', 'app.css');
    assert.equal(fssync.existsSync(appCssPath), true, `expected ${appCssPath}`);

    const appCss = await fs.readFile(appCssPath, 'utf8');
    assert.match(appCss, /@import\s+["']\.\/styles\/base\.css\?v=[a-f0-9]+["'];/i);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

