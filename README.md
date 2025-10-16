# @webstir-io/webstir-frontend

Frontend build and publish tooling for Webstir workspaces. Implements the module-provider contract and powers the default `webstir` CLI workflows for build, watch, and publish.

## Install

```bash
npm install @webstir-io/webstir-frontend
```

## Development

```bash
npm ci
npm run build
npm test
```

## Scripts

| Command        | Description                                    |
| -------------- | ---------------------------------------------- |
| `npm run build` | Compile TypeScript sources to `dist/`.         |
| `npm test`      | Run the frontend package tests.                |
| `npm run clean` | Remove build artifacts.                        |

## License

MIT © Electric Coding LLC and contributors
