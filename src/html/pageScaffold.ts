import path from 'node:path';
import { FOLDERS, FILES, EXTENSIONS } from '../core/constants.js';
import { ensureDir, pathExists, writeFile } from '../utils/fs.js';

export interface PageScaffoldOptions {
    readonly workspaceRoot: string;
    readonly pageName: string;
    readonly mode?: 'standard' | 'ssg';
    readonly paths: {
        readonly pages: string;
        readonly app: string;
    };
}

export async function createPageScaffold(options: PageScaffoldOptions): Promise<void> {
    const pageDir = path.join(options.paths.pages, options.pageName);
    if (await pathExists(pageDir)) {
        throw new Error(`Page '${options.pageName}' already exists.`);
    }

    await ensureDir(pageDir);

    const mode = options.mode ?? 'standard';
    const writes: Promise<void>[] = [
        writeFile(path.join(pageDir, `${FILES.index}${EXTENSIONS.html}`), buildHtmlTemplate(options.pageName, mode)),
        writeFile(path.join(pageDir, `${FILES.index}${EXTENSIONS.css}`), buildCssTemplate(options.pageName))
    ];

    if (mode === 'standard') {
        writes.push(writeFile(path.join(pageDir, `${FILES.index}${EXTENSIONS.ts}`), buildScriptTemplate()));
    }

    await Promise.all(writes);
}

function buildHtmlTemplate(pageName: string, mode: 'standard' | 'ssg'): string {
    const script = mode === 'standard'
        ? `    <script type="module" src="${FILES.index}${EXTENSIONS.js}" async></script>`
        : `    <!-- Add ${FILES.index}${EXTENSIONS.ts} to enable JS on this page. -->`;

    return `<head>
    <meta charset="utf-8">
    <title>${pageName}</title>
    <link rel="stylesheet" href="${FILES.index}${EXTENSIONS.css}">
</head>
<body>
    <main>
        <h1>${pageName}</h1>
        <p>Content for the ${pageName} page.</p>
    </main>
${script}
</body>
`;
}

function buildCssTemplate(pageName: string): string {
    return `/* ${pageName} Page Styles */
@import "@app/app.css";

/* Add your page-specific styles here */
`;
}

function buildScriptTemplate(): string {
    return `// Page entry point
import '../../app/app';

// Add page-specific logic here
`;
}
