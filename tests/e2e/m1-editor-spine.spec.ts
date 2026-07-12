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
