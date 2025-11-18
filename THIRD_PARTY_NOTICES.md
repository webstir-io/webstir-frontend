# Third-Party Notices

Webstir Frontend uses a number of third-party libraries. This file highlights dependencies with licenses that carry additional attribution or notice expectations beyond Webstir’s MIT license.

This list is not exhaustive of all dependencies, but focuses on notable licenses and data sets. For a full view, run a license audit (for example: `npx license-checker --production --summary`).

## Libraries

- **sharp / libvips**
  - Purpose: image processing (resizing, format conversion, optimization) used during frontend build and publish steps.
  - License: LGPL-3.0-or-later
  - Upstream:
    - sharp: https://github.com/lovell/sharp
    - sharp-libvips: https://github.com/lovell/sharp-libvips

- **caniuse-lite**
  - Purpose: browser capability data used via Browserslist/autoprefixer to decide which CSS features need prefixes or fallbacks.
  - License: CC-BY-4.0
  - Upstream: https://github.com/browserslist/caniuse-lite

