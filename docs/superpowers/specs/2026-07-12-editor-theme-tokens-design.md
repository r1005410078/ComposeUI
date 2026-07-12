# Editor Theme Tokens Design

## Goal

Restyle the Dockview editor workspace to match the approved compact dark navy reference while making visual customization depend on one framework-agnostic theme file. Consumers using React, Vue 2, Vue 3, Angular, or plain DOM must receive the same styling contract.

## Scope

Phase one provides one built-in default theme. Changing the theme file and rebuilding is sufficient; runtime theme switching is not required yet.

The theme controls:

- colors and opacity
- typography
- spacing and control dimensions
- border widths and radii
- shadows
- interaction states

The layout, component selectors, responsive behavior, and interaction logic remain outside the theme file.

## Architecture

Add `packages/editor/src/theme.css` as the single source of default theme tokens. It contains custom-property declarations only and does not style component selectors directly.

Theme variables are scoped to `.composeui-editor__workspace-host` and editor roots that can be mounted independently. This prevents global host-page pollution while allowing a future outer theme class to override the same variables at runtime.

The style layers have distinct responsibilities:

- `theme.css` defines semantic visual tokens and their default values.
- `editor.css` defines the component tree, canvas, grid, selection, and resize-handle structure using theme tokens.
- `workspace/workspace.css` defines the app bar, toolbar, Dockview chrome, panels, controls, and responsive layout using theme tokens.
- Dockview's distributed stylesheet provides its structural base and loads before ComposeUI theme and component styles.

The package exports both:

- `@composeui/editor/editor.css` as the complete backward-compatible editor stylesheet
- `@composeui/editor/theme.css` as the standalone theme-token entry

The standard JavaScript entry continues loading the default complete styling, so existing consumers require no migration.

## Token Model

Tokens use semantic names instead of component-specific color names. The initial groups are:

- surfaces: application, panel, elevated panel, canvas, toolbar, and input backgrounds
- text: primary, secondary, muted, disabled, and inverse
- borders: subtle, default, strong, and focus
- accents: primary, hover, active, and selection
- states: success, warning, danger, and disabled
- canvas: major grid, minor grid, board boundary, selection stroke, and selection fill
- dimensions: app bar height, tab height, toolbar height, icon-button size, panel padding, gaps, input height, and tree-row height
- shape and depth: small/default radii and panel/control shadows
- typography: font family, base size, compact size, heading size, and weights

Structural CSS must not retain core palette literals. Exceptional literals are allowed only where they represent document content rather than editor chrome, such as a user-authored node fill.

## Visual Direction

The default theme follows the supplied BMS reference:

- deep navy application and panel surfaces with clear but restrained elevation
- saturated blue for active tabs, focus, selections, and primary commands
- compact controls and tabs suitable for a frequently used editor
- thin low-contrast panel borders
- readable cool white primary text and blue-gray secondary text
- subtle shadows rather than decorative gradients
- a dark canvas with fine blue grid lines while preserving visible document nodes and selection handles

Run and save remain high-emphasis blue actions. Utility toolbar buttons use quiet surfaces and become brighter on hover or active state.

## Dockview Integration

ComposeUI overrides Dockview variables and chrome selectors inside the workspace scope. Tabs, active-tab indicators, group headers, separators, split-view sash states, and panel backgrounds consume the same semantic tokens as first-party panels.

Dockview layout behavior and persistence are unchanged. Theme changes must not alter panel identifiers, default placement, serialization, or minimum usable dimensions.

## Compatibility

The implementation remains CSS-only at the public theming boundary. No framework provider, hook, component wrapper, or JavaScript initialization is required.

Existing applications importing the editor package continue receiving the default theme. Advanced consumers may import the standalone theme entry or override scoped variables after the package stylesheet. Runtime multi-theme APIs are intentionally deferred, but the variable contract must not block that addition.

## Testing

Automated coverage will verify:

- the standalone theme stylesheet is emitted and exported by the package
- required semantic token groups exist
- structural styles consume key tokens instead of defining core hard-coded palette values
- existing editor and workspace behavior remains unchanged
- the package builds with the intended stylesheet order

The full unit, formatting, lint, type-check, and build suites must pass. Playwright verifies the canonical Godot-style panel layout, visible canvas content, localized chrome, and stable desktop and narrow viewport geometry.

Visual QA checks the desktop and narrow layouts for clipping, overlapping text, blank canvas output, broken Dockview sizing, and inconsistent active or disabled states.

## Non-Goals

- runtime theme switching UI
- multiple bundled themes
- framework-specific theme adapters
- changing Dockview layout persistence
- redesigning editor commands or panel behavior
- introducing decorative assets or gradients

