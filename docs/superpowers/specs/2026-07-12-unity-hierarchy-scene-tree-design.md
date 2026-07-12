# Unity Hierarchy Scene Tree Design

## Goal

Refine the ComposeUI scene tree into a compact Unity Hierarchy-style editor surface while preserving its existing selection, keyboard, rename, visibility, lock, reorder, delete, and drag behavior.

## Scope

This change affects the scene tree presentation and its icon rendering. It does not change the document schema, editor commands, panel layout, selection model, or public tree API.

## Visual Structure

Each tree row uses a compact height of approximately 28 pixels. Indentation, icon size, row height, action opacity, hover color, selected color, and drag indicator color are theme tokens in `theme.css`.

The row is divided into three regions:

- disclosure control: a thin right/down chevron for collapsed and expanded nodes
- identity: a type icon followed by an ellipsized node name
- actions: visibility, lock, move up, and move down icon buttons

Pages use a page/scene icon. Rectangle nodes use a square object icon. Lucide icons are used consistently rather than text glyphs or custom SVG markup.

## Interaction States

Actions remain in the row layout so names do not resize when actions become prominent.

Action icons are muted by default. They become clear when the row is hovered, keyboard focus is inside the row, or the row is selected. Active semantic states remain clear at all times:

- hidden nodes show the visibility-off state
- locked nodes show the locked state
- disabled reorder actions remain visibly disabled

Hover applies a restrained full-row background. Selection applies a stronger blue-gray full-row background and a narrow accent line on the leading edge. Keyboard focus uses the existing theme focus ring without changing row geometry.

During drag, the source row is muted. A valid target row displays an insertion indicator. Invalid targets keep the existing no-drop behavior and do not display the indicator.

## Behavior Preservation

The implementation preserves:

- stable existing test IDs
- tree and treeitem ARIA roles
- arrow, Home, End, Enter, Space, Delete, and Backspace behavior
- click and modifier multi-selection
- double-click inline rename
- visibility and lock commands
- sibling move up/down commands
- same-parent drag reorder validation
- focus and scroll restoration after rebuilds

Buttons retain accessible names and tooltips. Icon-only controls do not expose raw glyph text.

## Architecture

`component-tree.ts` owns semantic DOM and icon state. It creates Lucide icon elements for disclosure, record type, and actions, and exposes state through existing ARIA/data attributes.

`editor.css` owns scene tree layout and interaction styling. It consumes only semantic theme variables for colors, dimensions, opacity, and spacing.

`theme.css` owns the default Unity-inspired token values. Consumers can change tree density and emphasis without changing component code.

No framework-specific adapter is introduced; the tree remains plain DOM and works through the same editor package from React, Vue 2, Vue 3, Angular, or direct DOM hosts.

## Testing

Unit tests verify:

- disclosure and record-type icons render
- action buttons retain test IDs and accessible labels
- visibility and lock states select the correct icons and state attributes
- existing keyboard, rename, selection, and reorder behavior remains unchanged
- structural CSS consumes the new tree theme tokens

Playwright verifies the scene tree remains visible, compact, non-overlapping, and horizontally contained at desktop and narrow viewports. Existing end-to-end tree operations continue to pass.

## Non-Goals

- adding hierarchy search or filtering
- changing tree data or command semantics
- introducing context menus
- adding drag reparenting
- hiding actions completely until hover
- reproducing Unity branding or proprietary assets

