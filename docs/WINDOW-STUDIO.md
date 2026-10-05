# Window Studio: repository integration and audit

Base audited: `origin/main` at `e32b1eb`, from `markrotar1000-code/windowsbyclearveiw`. The earlier standalone prototype is replaced here by an embedded component in `/window-features#window-studio`.

## Site fit

- Uses the existing BaseLayout, real Brand component, navigation, footer, Outfit font and design tokens. No external fonts, standalone wordmark, additional primary nav link or new page metadata.
- 3D is optional. The component renders a small WebP poster before the visitor presses **Explore in 3D**. Only then does the browser import Three.js and load the selected GLB. Other models load on selection.
- Uses the estimate form's existing `scope` handoff. The style and appearance are editable project notes, explicitly illustrative, not an order, price or confirmed manufacturer option. No estimate is submitted by the viewer.
- No automatic motion. Pointer drag rotates, scroll/pinch zooms, and a labeled keyboard-accessible range controls the primary sash. A picture window stays fixed. Exterior/interior/detail presets and Reset are buttons.
- Renders only on demand; suspends while hidden or outside the viewport. Astro navigation disposes the renderer, controls, observers and geometry. Returning to the page creates an unstarted viewer. Loading or WebGL failure leaves a poster and estimate link.
- Models have a versioned path and one-week cache policy. Increase the asset version for revised geometry. Browser glass is real-time PBR, not a reproduction of a Cycles render.

## Assets and contract

`public/models/windows/v001/` contains four self-contained GLBs exported from the existing editable **window-library-v005** picture, casement, double-hung and slider projects, plus reduced studio posters. Source Blender files remain unchanged. No third-party photographic textures or HDRI are embedded in the exports; procedural materials were adapted to PBR swatches.

The operation parent has `web_primary`, `web_open_position` and `web_open_quaternion` extras sampled from the Blender control. The runtime retains its closed local position and quaternion, interpolates to the exported open transform, and merges geometry only within a common parent/material. It never merges moving sash geometry into the fixed frame. `scripts/test-window-studio.mjs` validates this asset contract and the built integration.

KNOWN: fresh imports of all four GLBs in Blender 5.2.2 LTS succeeded with finite transforms; primary controls were retained. Assets range from 1.44 to 2.93 MB. Browsing the built site exercised all four models, operating ranges, reset, colors, navigation away/back and the estimate handoff. Layout checks from 320 through 1920 px found no horizontal overflow. Poster fallback was also observed during a failed development-module load.

INFERRED: geometry, dimensions, material finish names and swatches are those of the unbranded visual library. They are not exact Cascade or Milgard products. The section states this visibly.

VERIFY before production publication: owner/installer review of the illustration, confirmation of desired product options, visual approval, performance on physical phones and Safari, and supplier-specific geometry if this becomes a product configurator. No manufacturer specs, performance figures, prices or ordering commitments were added. No live deployment is included.

## Audit fixes

1. **High dependency advisory:** the original lockfile contained `http-cache-semantics` 4.2.0 under Astro. Updated to compatible 4.3.0; npm audit reports zero vulnerabilities after the update. The new Three.js dependency is MIT licensed.
2. **Windows test runner:** npm's `.cmd` wrapper could not be spawned directly. `test:all` now invokes npm's CLI through Node when npm supplies its path, without a shell.
3. **Five baseline test failures:** reproduced on the untouched base commit in a separate checkout. Four tests assumed LF-only text (Command Center handler extraction, siding markup, mobile CSS and PWA headers). They normalize CRLF before matching. The field-photo test now normalizes relative path separators before excluding the shared helper. These changes preserve assertions; they do not change internal application behavior.

Validation: `npm run test:all` completes **all 46 steps**, including the production build, the new asset/integration test, SEO, estimate endpoint, public terminology, and all internal regressions. `git diff --check` passes. The repo's current billing note says GitHub Actions may be unavailable, so local results are the confirmed gate.

Audit scope was the public site's integration seams, dependency advisories and full existing regression suite. This is not a claim of a comprehensive independent review of every internal API. Existing analytics scripts emitted a duplicate-initialization warning on local navigation; no analytics behavior was changed in this work.
