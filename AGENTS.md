# AGENTS.md (Repo Stub)

This repository follows the org baseline at `../workspace-tools/AGENTS.md`.

- Scope: Frontend module provider and CLI.
- Start here: `README.md` and `package.json` exports.
- Precedence: org baseline; add repo-specific rules here if needed.
- Release note: npm tarball ships `src/`, `scripts/`, `tests/`, `tsconfig.json`, and `package-lock.json` so downstream tooling can rebuild without cloning; keep them publish-ready.
- Use `npm run release -- <patch|minor|major>` (scripts/publish.sh) for version bumps; it refreshes the lockfile and enforces clean git + build/test/smoke before tagging.
