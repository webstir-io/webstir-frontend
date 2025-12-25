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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-page-css-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  const partialsDir = path.join(pageDir, 'partials');
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(partialsDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main></body></html>',
    'utf8'
  );
  await fs.writeFile(path.join(appDir, 'app.css'), '', 'utf8');
  await fs.writeFile(path.join(pageDir, 'index.html'), '<head></head><main><section>Home</section></main>', 'utf8');

  await fs.writeFile(
    path.join(pageDir, 'index.css'),
    [
      '@layer overrides { .home { color: red; } }',
      '@import "./layout.css";',
      '@import url("./partials/colors.css");'
    ].join('\n'),
    'utf8'
  );

  await fs.writeFile(
    path.join(pageDir, 'layout.css'),
    [
      '@layer overrides { .layout { display: grid; } }',
      '@import "./partials/typography.css";'
    ].join('\n'),
    'utf8'
  );

  await fs.writeFile(
    path.join(partialsDir, 'colors.css'),
    '@layer overrides { .colors { color: blue; } }',
    'utf8'
  );

  await fs.writeFile(
    path.join(partialsDir, 'typography.css'),
    '@layer overrides { .type { font-weight: 700; } }',
    'utf8'
  );

  return root;
}

test('build inlines page-local CSS @import files', async (t) => {
  const frontendProvider = await loadProviderOrSkip(t);
  if (!frontendProvider) return;
  const workspace = await createWorkspace();

  try {
    await frontendProvider.build({ workspaceRoot: workspace, env: { WEBSTIR_MODULE_MODE: 'build' }, incremental: false });

    const cssPath = path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.css');
    assert.equal(fssync.existsSync(cssPath), true, `expected ${cssPath}`);

    assert.equal(
      fssync.existsSync(path.join(workspace, 'build', 'frontend', 'pages', 'home', 'layout.css')),
      true,
      'expected imported layout.css copied for dev server'
    );
    assert.equal(
      fssync.existsSync(path.join(workspace, 'build', 'frontend', 'pages', 'home', 'partials', 'colors.css')),
      true,
      'expected imported nested css copied for dev server'
    );

    const css = await fs.readFile(cssPath, 'utf8');
    assert.ok(css.includes('.home'), 'expected entry css content');
    assert.ok(css.includes('.layout'), 'expected imported css content');
    assert.ok(css.includes('.colors'), 'expected imported css content');
    assert.ok(css.includes('.type'), 'expected nested imported css content');
    assert.equal(css.includes('@import "./layout.css"'), false, 'expected imports to be inlined');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
