# AGENTS.md (Repo Stub)

This repository follows the org baseline at `../workspace-tools/AGENTS.md`.

- Scope: Frontend module provider and CLI.
- Start here: `README.md` and `package.json` exports.
- Precedence: org baseline; add repo-specific rules here if needed.
- Release note: npm tarball now includes `src/` so downstream tooling can rebuild; keep that directory in publish-ready shape.
- Use `npm run release -- <patch|minor|major>` (scripts/publish.sh) for version bumps; it enforces clean git + build/test/smoke before tagging and auto-cleans tags/commits if a later step fails.
