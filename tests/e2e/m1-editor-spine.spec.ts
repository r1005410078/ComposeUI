import { expect, test } from "@playwright/test"

test("synchronizes selection, free-layout drag, undo and redo", async ({ page }) => {
  await page.goto("/")
  const shell = page.getByTestId("editor-shell")
  const node = page.locator("[data-node-id='node-red']")

  await node.click()
  await expect(shell).toBeFocused()
  await expect(page.getByTestId("selection-node-red")).toBeAttached()
  await expect(
    page.locator("[role='treeitem']:has([data-testid='tree-node-red'])"),
  ).toHaveAttribute("aria-selected", "true")

  const box = await node.boundingBox()
  if (box === null) throw new Error("node-red was not rendered")
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 40)
  await page.mouse.up()

  await expect(node).toHaveCSS("left", "120px")
  await expect(node).toHaveCSS("top", "102px")
  await page.keyboard.press("Meta+z")
  await expect(node).toHaveCSS("left", "80px")
  await expect(node).toHaveCSS("top", "72px")
  await page.keyboard.press("Control+y")
  await expect(node).toHaveCSS("left", "120px")
  await expect(node).toHaveCSS("top", "102px")
  await page.keyboard.press("Control+z")
  await expect(node).toHaveCSS("left", "80px")
  await expect(node).toHaveCSS("top", "72px")
  await page.keyboard.press("Meta+Shift+z")
  await expect(node).toHaveCSS("left", "120px")
  await expect(node).toHaveCSS("top", "102px")
})

test("deletes the selected tree node through a command and restores it with undo", async ({
  page,
}) => {
  await page.goto("/")
  const treeNode = page.getByTestId("tree-node-blue")
  const canvasNode = page.locator("[data-node-id='node-blue']")

  await treeNode.click()
  await expect(page.getByTestId("selection-node-blue")).toBeAttached()

  await treeNode.press("Delete")
  await expect(canvasNode).toHaveCount(0)

  await page.getByTestId("editor-shell").focus()
  await page.keyboard.press("Meta+z")
  await expect(canvasNode).toBeVisible()
})

test("marquee-selects intersecting nodes and renders the SVG overlay", async ({ page }) => {
  await page.goto("/")
  const workspace = page.getByTestId("workspace")
  const box = await workspace.boundingBox()
  if (box === null) throw new Error("workspace was not rendered")

  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 340, box.y + 250)
  await expect(page.getByTestId("marquee-selection")).toBeAttached()
  await page.mouse.up()

  await expect(page.getByTestId("marquee-selection")).toHaveCount(0)
  await expect(page.getByTestId("selection-node-red")).toBeAttached()
  await expect(page.getByTestId("selection-node-blue")).toHaveCount(0)
})

test("pans, zooms at the pointer, multi-selects and exports JSON without Session state", async ({
  page,
}) => {
  await page.goto("/")
  const workspace = page.getByTestId("workspace")
  const world = page.getByTestId("world")
  const red = page.locator("[data-node-id='node-red']")
  const blue = page.locator("[data-node-id='node-blue']")

  const workspaceBox = await workspace.boundingBox()
  if (workspaceBox === null) throw new Error("workspace was not rendered")
  await page.mouse.move(workspaceBox.x + 500, workspaceBox.y + 300)
  await page.mouse.wheel(0, -120)
  await expect(world).not.toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)")

  await page.mouse.move(workspaceBox.x + 700, workspaceBox.y + 500)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(workspaceBox.x + 730, workspaceBox.y + 525)
  await page.mouse.up({ button: "middle" })

  await red.click()
  await blue.click({ modifiers: ["Shift"] })
  await expect(page.getByTestId("selection-node-red")).toBeAttached()
  await expect(page.getByTestId("selection-node-blue")).toBeAttached()

  await page.getByTestId("export-json").click()
  const output = page.getByTestId("canonical-json-output")
  await expect(output).toContainText('"node-red"')
  await expect(output).not.toContainText("viewport")
  await expect(output).not.toContainText("selection")
  await expect(output).not.toContainText("gridVisible")
})

test("creates a node and performs tree rename, visibility, lock and reorder", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("create-node").click()
  const created = page.locator("[data-node-id='node-created-1']")
  await expect(created).toBeVisible()

  await page.getByTestId("tree-node-created-1").dblclick()
  await page.getByTestId("tree-rename-node-created-1").fill("Created card")
  await page.getByTestId("tree-rename-node-created-1").press("Enter")
  await expect(page.getByTestId("tree-node-created-1")).toHaveText("Created card")

  await page.getByTestId("tree-lock-node-created-1").click()
  const before = await created.boundingBox()
  if (before === null) throw new Error("created node was not rendered")
  await page.mouse.move(before.x + 10, before.y + 10)
  await page.mouse.down()
  await page.mouse.move(before.x + 50, before.y + 50)
  await page.mouse.up()
  await expect(created).toHaveCSS("left", "120px")
  await expect(created).toHaveCSS("top", "120px")

  await page.getByTestId("tree-lock-node-created-1").click()
  await page.getByTestId("tree-move-up-node-created-1").click()
  const rows = page.locator("[data-tree-control='select']")
  await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-red")
  await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-created-1")
  await expect(rows.nth(3)).toHaveAttribute("data-tree-id", "node-blue")
  await page.getByTestId("editor-shell").focus()
  await page.keyboard.press("Meta+z")
  await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-blue")

  await page.getByTestId("tree-visibility-node-created-1").click()
  await expect(created).toHaveCount(0)
})

test("drag-reorders sibling tree rows through one undoable command", async ({ page }) => {
  await page.goto("/")
  const rows = page.locator("[data-tree-control='select']")

  await page.getByTestId("tree-row-node-red").dragTo(page.getByTestId("tree-row-node-blue"))
  await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-blue")
  await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-red")

  await page.getByTestId("editor-shell").focus()
  await page.keyboard.press("Meta+z")
  await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-red")
  await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-blue")
})
