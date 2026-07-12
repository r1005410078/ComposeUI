import { expect, test, type Locator, type Page } from "@playwright/test"

async function marqueeSelectRedAndBlue(page: Page) {
  const workspace = page.getByTestId("workspace")
  const red = page.locator("[data-node-id='node-red']")
  const blue = page.locator("[data-node-id='node-blue']")
  const workspaceBox = await workspace.boundingBox()
  const redBox = await red.boundingBox()
  const blueBox = await blue.boundingBox()
  if (workspaceBox === null || redBox === null || blueBox === null) {
    throw new Error("workspace or nodes were not rendered")
  }

  const left = Math.min(redBox.x, blueBox.x) - 12
  const top = Math.min(redBox.y, blueBox.y) - 12
  const right = Math.max(redBox.x + redBox.width, blueBox.x + blueBox.width) + 12
  const bottom = Math.max(redBox.y + redBox.height, blueBox.y + blueBox.height) + 12
  await dispatchPointer(workspace, "pointerdown", {
    x: Math.max(workspaceBox.x, left),
    y: Math.max(workspaceBox.y, top),
  })
  await dispatchWindowPointer(page, "pointermove", { x: right, y: bottom })
  await dispatchWindowPointer(page, "pointerup", { x: right, y: bottom })
  await expect(page.getByTestId("selection-node-red")).toBeAttached()
  await expect(page.getByTestId("selection-node-blue")).toBeAttached()
}

async function readSvgRect(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element) => ({
    x: Number(element.getAttribute("x")),
    y: Number(element.getAttribute("y")),
    width: Number(element.getAttribute("width")),
    height: Number(element.getAttribute("height")),
  }))
}

async function dispatchPointer(
  target: Locator,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
  options: { button?: number; shiftKey?: boolean } = {},
) {
  await target.dispatchEvent(type, {
    bubbles: true,
    button: options.button ?? 0,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    pointerType: "mouse",
    shiftKey: options.shiftKey ?? false,
  })
}

async function dispatchWindowPointer(
  page: Page,
  eventType: "pointermove" | "pointerup",
  eventPoint: { x: number; y: number },
) {
  await page.evaluate(
    ({ eventType: dispatchedType, eventPoint: dispatchedPoint }) =>
      window.dispatchEvent(
        new PointerEvent(dispatchedType, {
          bubbles: true,
          clientX: dispatchedPoint.x,
          clientY: dispatchedPoint.y,
          pointerId: 1,
          pointerType: "mouse",
        }),
      ),
    { eventType, eventPoint },
  )
}

async function focusWorkspace(page: Page) {
  await openCanvas(page)
  await page.getByTestId("editor-shell").focus()
}

async function openCanvas(page: Page) {
  await page.getByRole("tab", { name: "Canvas" }).click()
}

async function openScene(page: Page) {
  await page.getByRole("tab", { name: "Scene" }).click()
}

test.describe("Dockview canvas gesture coverage", () => {
  test("synchronizes selection, free-layout drag, undo and redo", async ({ page }) => {
    await page.goto("/")
    await openScene(page)
    await page.getByTestId("tree-node-red").click()
    await openCanvas(page)
    const node = page.locator("[data-node-id='node-red']")
    await expect(page.getByTestId("selection-node-red")).toBeAttached()
    await expect(
      page.locator("[role='treeitem']:has([data-testid='tree-node-red'])"),
    ).toHaveAttribute("aria-selected", "true")

    const box = await node.boundingBox()
    if (box === null) throw new Error("node-red was not rendered")
    await dispatchPointer(node, "pointerdown", { x: box.x + 10, y: box.y + 10 })
    await dispatchWindowPointer(page, "pointermove", { x: box.x + 50, y: box.y + 40 })
    await dispatchWindowPointer(page, "pointerup", { x: box.x + 50, y: box.y + 40 })

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

  test("shows eight resize handles for a single selected rectangle", async ({ page }) => {
    await page.goto("/")
    await openScene(page)
    await page.getByTestId("tree-node-red").click()
    await openCanvas(page)
    const red = page.locator("[data-node-id='node-red']")

    for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
      await expect(page.getByTestId(`group-resize-${handle}`)).toBeAttached()
    }
    await expect(page.locator("[data-resize-node-id]")).toHaveCount(0)

    const handle = await page.getByTestId("group-resize-se").boundingBox()
    if (handle === null) throw new Error("southeast resize handle was not rendered")
    const resizeHandle = page.getByTestId("group-resize-se")
    await dispatchPointer(resizeHandle, "pointerdown", {
      x: handle.x + handle.width / 2,
      y: handle.y + handle.height / 2,
    })
    await dispatchWindowPointer(page, "pointermove", {
      x: handle.x + handle.width / 2 + 30,
      y: handle.y + handle.height / 2 + 20,
    })
    await dispatchWindowPointer(page, "pointerup", {
      x: handle.x + handle.width / 2 + 30,
      y: handle.y + handle.height / 2 + 20,
    })

    await expect(red).toHaveCSS("width", "270px")
    await expect(red).toHaveCSS("height", "180px")
  })

  test("deletes the selected tree node through a command and restores it with undo", async ({
    page,
  }) => {
    await page.goto("/")
    const treeNode = page.getByTestId("tree-node-blue")
    const canvasNode = page.locator("[data-node-id='node-blue']")

    await openScene(page)
    await treeNode.click()
    await openCanvas(page)
    await expect(page.getByTestId("selection-node-blue")).toBeAttached()

    await openScene(page)
    await treeNode.click()
    await treeNode.press("Delete")
    await openCanvas(page)
    await expect(canvasNode).toHaveCount(0)

    await openCanvas(page)
    await focusWorkspace(page)
    await page.keyboard.press("Meta+z")
    await expect(canvasNode).toBeVisible()
  })

  test("marquee-selects intersecting nodes and renders the SVG overlay", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    const workspace = page.getByTestId("workspace")
    const box = await workspace.boundingBox()
    if (box === null) throw new Error("workspace was not rendered")

    await dispatchPointer(workspace, "pointerdown", { x: box.x + 40, y: box.y + 40 })
    await dispatchWindowPointer(page, "pointermove", { x: box.x + 340, y: box.y + 250 })
    await expect(page.getByTestId("marquee-selection")).toBeAttached()
    await dispatchWindowPointer(page, "pointerup", { x: box.x + 340, y: box.y + 250 })

    await expect(page.getByTestId("marquee-selection")).toHaveCount(0)
    await expect(page.getByTestId("selection-node-red")).toBeAttached()
    await expect(page.getByTestId("selection-node-blue")).toHaveCount(0)
  })

  test("marquee-selects nodes when dragged from bottom-right to top-left", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    const red = page.locator("[data-node-id='node-red']")
    const box = await red.boundingBox()
    if (box === null) throw new Error("node-red was not rendered")
    const workspace = page.getByTestId("workspace")

    await dispatchPointer(workspace, "pointerdown", {
      x: box.x + box.width + 12,
      y: box.y + box.height + 12,
    })
    await dispatchWindowPointer(page, "pointermove", { x: box.x - 12, y: box.y - 12 })
    await expect(page.getByTestId("marquee-selection")).toHaveAttribute("width", /.+/)
    await dispatchWindowPointer(page, "pointerup", { x: box.x - 12, y: box.y - 12 })

    await expect(page.getByTestId("selection-node-red")).toBeAttached()
    await expect(page.getByTestId("selection-node-blue")).toHaveCount(0)
  })

  test("moves all marquee-selected nodes in one drag", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    const red = page.locator("[data-node-id='node-red']")
    const blue = page.locator("[data-node-id='node-blue']")
    const redBox = await red.boundingBox()
    const blueBox = await blue.boundingBox()
    if (redBox === null || blueBox === null) throw new Error("nodes were not rendered")

    const left = Math.min(redBox.x, blueBox.x) - 12
    const top = Math.min(redBox.y, blueBox.y) - 12
    const right = Math.max(redBox.x + redBox.width, blueBox.x + blueBox.width) + 12
    const bottom = Math.max(redBox.y + redBox.height, blueBox.y + blueBox.height) + 12
    await dispatchPointer(page.getByTestId("workspace"), "pointerdown", { x: left, y: top })
    await dispatchWindowPointer(page, "pointermove", { x: right, y: bottom })
    await dispatchWindowPointer(page, "pointerup", { x: right, y: bottom })
    await expect(page.getByTestId("selection-node-red")).toBeAttached()
    await expect(page.getByTestId("selection-node-blue")).toBeAttached()

    await dispatchPointer(red, "pointerdown", { x: redBox.x + 20, y: redBox.y + 20 })
    await dispatchWindowPointer(page, "pointermove", {
      x: redBox.x + 50,
      y: redBox.y + 45,
    })
    await expect(page.getByTestId("selection-node-red")).toHaveAttribute(
      "transform",
      "translate(30 25)",
    )
    await expect(page.getByTestId("selection-node-blue")).toHaveAttribute(
      "transform",
      "translate(30 25)",
    )
    await expect(page.getByTestId("group-selection-frame")).toHaveAttribute(
      "transform",
      "translate(30 25)",
    )
    await expect(page.getByTestId("group-resize-se")).toHaveAttribute(
      "transform",
      "translate(30 25)",
    )
    await dispatchWindowPointer(page, "pointerup", { x: redBox.x + 50, y: redBox.y + 45 })

    await expect(red).toHaveCSS("left", "110px")
    await expect(red).toHaveCSS("top", "97px")
    await expect(blue).toHaveCSS("left", "410px")
    await expect(blue).toHaveCSS("top", "265px")
    await expect(page.getByTestId("selection-node-red")).not.toHaveAttribute("transform", /.+/)
    await expect(page.getByTestId("selection-node-blue")).not.toHaveAttribute("transform", /.+/)
    await expect(page.getByTestId("group-selection-frame")).not.toHaveAttribute("transform", /.+/)
    await expect(page.getByTestId("group-resize-se")).not.toHaveAttribute("transform", /.+/)
  })

  test("resizes a multi-selection from the southeast handle and undoes both layouts", async ({
    page,
  }) => {
    await page.goto("/")
    await openCanvas(page)
    await marqueeSelectRedAndBlue(page)

    const handles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
    for (const handle of handles) {
      await expect(page.getByTestId(`group-resize-${handle}`)).toBeAttached()
    }

    const red = page.locator("[data-node-id='node-red']")
    const blue = page.locator("[data-node-id='node-blue']")
    const initialRed = await red.evaluate((element) => ({
      left: getComputedStyle(element).left,
      top: getComputedStyle(element).top,
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height,
    }))
    const initialBlue = await blue.evaluate((element) => ({
      left: getComputedStyle(element).left,
      top: getComputedStyle(element).top,
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height,
    }))
    const handleBox = await page.getByTestId("group-resize-se").boundingBox()
    if (handleBox === null) throw new Error("southeast group handle was not rendered")

    const resizeHandle = page.getByTestId("group-resize-se")
    await dispatchPointer(resizeHandle, "pointerdown", {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    })
    await dispatchWindowPointer(page, "pointermove", {
      x: handleBox.x + 100,
      y: handleBox.y + 80,
    })

    await expect(red).not.toHaveCSS("width", initialRed.width)
    await expect(red).not.toHaveCSS("height", initialRed.height)
    await expect(blue).not.toHaveCSS("left", initialBlue.left)
    await expect(blue).not.toHaveCSS("top", initialBlue.top)
    await expect(blue).not.toHaveCSS("width", initialBlue.width)
    await expect(blue).not.toHaveCSS("height", initialBlue.height)
    const resizedRed = await red.evaluate((element) => ({
      left: getComputedStyle(element).left,
      top: getComputedStyle(element).top,
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height,
    }))
    const resizedBlue = await blue.evaluate((element) => ({
      left: getComputedStyle(element).left,
      top: getComputedStyle(element).top,
      width: getComputedStyle(element).width,
      height: getComputedStyle(element).height,
    }))
    await dispatchWindowPointer(page, "pointerup", {
      x: handleBox.x + 100,
      y: handleBox.y + 80,
    })

    await expect(red).toHaveCSS("left", resizedRed.left)
    await expect(red).toHaveCSS("top", resizedRed.top)
    await expect(red).toHaveCSS("width", resizedRed.width)
    await expect(red).toHaveCSS("height", resizedRed.height)
    await expect(blue).toHaveCSS("left", resizedBlue.left)
    await expect(blue).toHaveCSS("top", resizedBlue.top)
    await expect(blue).toHaveCSS("width", resizedBlue.width)
    await expect(blue).toHaveCSS("height", resizedBlue.height)

    await focusWorkspace(page)
    await page.keyboard.press("Meta+z")
    await expect(red).toHaveCSS("left", initialRed.left)
    await expect(red).toHaveCSS("top", initialRed.top)
    await expect(red).toHaveCSS("width", initialRed.width)
    await expect(red).toHaveCSS("height", initialRed.height)
    await expect(blue).toHaveCSS("left", initialBlue.left)
    await expect(blue).toHaveCSS("top", initialBlue.top)
    await expect(blue).toHaveCSS("width", initialBlue.width)
    await expect(blue).toHaveCSS("height", initialBlue.height)
  })

  test("keeps the southeast group corner fixed during northwest resize", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    await marqueeSelectRedAndBlue(page)

    const frame = page.getByTestId("group-selection-frame")
    const initial = await readSvgRect(page, "group-selection-frame")
    const initialRight = initial.x + initial.width
    const initialBottom = initial.y + initial.height
    const handleBox = await page.getByTestId("group-resize-nw").boundingBox()
    if (handleBox === null) throw new Error("northwest group handle was not rendered")

    const resizeHandle = page.getByTestId("group-resize-nw")
    await dispatchPointer(resizeHandle, "pointerdown", {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    })
    await dispatchWindowPointer(page, "pointermove", {
      x: handleBox.x - 50,
      y: handleBox.y - 40,
    })

    await expect
      .poll(async () => {
        const current = await readSvgRect(page, "group-selection-frame")
        return (
          Math.abs(current.x + current.width - initialRight) < 0.01 &&
          Math.abs(current.y + current.height - initialBottom) < 0.01
        )
      })
      .toBe(true)
    await expect(frame).toBeAttached()
    await dispatchWindowPointer(page, "pointerup", { x: handleBox.x - 50, y: handleBox.y - 40 })
  })

  test("pans, zooms at the pointer, multi-selects and exports JSON without Session state", async ({
    page,
  }) => {
    await page.goto("/")
    await openCanvas(page)
    const workspace = page.getByTestId("workspace")
    const world = page.getByTestId("world")
    const workspaceBox = await workspace.boundingBox()
    if (workspaceBox === null) throw new Error("workspace was not rendered")
    await workspace.dispatchEvent("wheel", {
      bubbles: true,
      clientX: workspaceBox.x + 500,
      clientY: workspaceBox.y + 300,
      deltaY: -120,
    })
    await expect(world).not.toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)")

    await dispatchPointer(
      workspace,
      "pointerdown",
      { x: workspaceBox.x + 700, y: workspaceBox.y + 500 },
      { button: 1 },
    )
    await dispatchWindowPointer(page, "pointermove", {
      x: workspaceBox.x + 730,
      y: workspaceBox.y + 525,
    })
    await dispatchWindowPointer(page, "pointerup", {
      x: workspaceBox.x + 730,
      y: workspaceBox.y + 525,
    })

    await openScene(page)
    await page.getByTestId("tree-node-red").click()
    await page.getByTestId("tree-node-blue").click({ modifiers: ["Shift"] })
    await openCanvas(page)
    await expect(page.getByTestId("selection-node-red")).toBeAttached()
    await expect(page.getByTestId("selection-node-blue")).toBeAttached()

    await page.getByTestId("export-json").click()
    const output = page.getByTestId("canonical-json-output")
    await expect(output).toContainText('"node-red"')
    await expect(output).not.toContainText("viewport")
    await expect(output).not.toContainText("selection")
    await expect(output).not.toContainText("gridVisible")
  })

  test("changes from grab to grabbing for space plus left-button pan", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    const workspace = page.getByTestId("workspace")
    const box = await workspace.boundingBox()
    if (box === null) throw new Error("workspace was not rendered")

    await page.mouse.move(box.x + 500, box.y + 300)
    await page.keyboard.down("Space")
    await expect(workspace).toHaveCSS("cursor", "grab")

    await dispatchPointer(workspace, "pointerdown", { x: box.x + 500, y: box.y + 300 })
    await expect(workspace).toHaveCSS("cursor", "grabbing")
    await dispatchWindowPointer(page, "pointermove", { x: box.x + 540, y: box.y + 330 })
    await expect(workspace).toHaveCSS("cursor", "grabbing")

    await dispatchWindowPointer(page, "pointerup", { x: box.x + 540, y: box.y + 330 })
    await page.keyboard.up("Space")
    await expect(workspace).toHaveCSS("cursor", "default")
  })

  test("persists the page overflow toggle and restores it through undo", async ({ page }) => {
    await page.goto("/")
    await openCanvas(page)
    const toggle = page.getByTestId("toggle-page-overflow")
    const board = page.getByTestId("page-board")
    const output = page.getByTestId("canonical-json-output")

    await expect(toggle).toHaveAttribute("aria-pressed", "true")
    await expect(board).toHaveCSS("overflow", "visible")
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await expect(board).toHaveCSS("overflow", "hidden")

    await page.getByTestId("export-json").click()
    await expect(output).toContainText('"overflow": "hidden"')

    await focusWorkspace(page)
    await page.keyboard.press("Meta+z")
    await expect(toggle).toHaveAttribute("aria-pressed", "true")
    await expect(board).toHaveCSS("overflow", "visible")
  })

  test("creates a node and performs tree rename, visibility, lock and reorder", async ({
    page,
  }) => {
    await page.goto("/")
    await openScene(page)
    await page.getByTestId("create-node").click()
    const created = page.locator("[data-node-id='node-created-1']")
    await openCanvas(page)
    await expect(created).toBeVisible()

    await openScene(page)
    await page.getByTestId("tree-node-created-1").dblclick()
    await page.getByTestId("tree-rename-node-created-1").fill("Created card")
    await page.getByTestId("tree-rename-node-created-1").press("Enter")
    await expect(page.getByTestId("tree-node-created-1")).toHaveText("Created card")

    await page.getByTestId("tree-lock-node-created-1").click()
    await openCanvas(page)
    const before = await created.boundingBox()
    if (before === null) throw new Error("created node was not rendered")
    await dispatchPointer(created, "pointerdown", { x: before.x + 10, y: before.y + 10 })
    await dispatchWindowPointer(page, "pointermove", { x: before.x + 50, y: before.y + 50 })
    await dispatchWindowPointer(page, "pointerup", { x: before.x + 50, y: before.y + 50 })
    await expect(created).toHaveCSS("left", "120px")
    await expect(created).toHaveCSS("top", "120px")

    await openScene(page)
    await page.getByTestId("tree-lock-node-created-1").click()
    await page.getByTestId("tree-move-up-node-created-1").click()
    const rows = page.locator("[data-tree-control='select']")
    await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-red")
    await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-created-1")
    await expect(rows.nth(3)).toHaveAttribute("data-tree-id", "node-blue")
    await openCanvas(page)
    await focusWorkspace(page)
    await page.keyboard.press("Meta+z")
    await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-blue")

    await page.getByTestId("tree-visibility-node-created-1").click()
    await expect(created).toHaveCount(0)
  })

  test("drag-reorders sibling tree rows through one undoable command", async ({ page }) => {
    await page.goto("/")
    await openScene(page)
    const rows = page.locator("[data-tree-control='select']")

    await page.getByTestId("tree-row-node-red").evaluate((source) => {
      const target = document.querySelector<HTMLElement>("[data-testid='tree-row-node-blue']")
      if (target === null) throw new Error("tree reorder target was not rendered")
      const dataTransfer = new DataTransfer()
      dataTransfer.setData("application/x-composeui-tree-node", "node-red")
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }))
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
      )
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }))
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }))
    })
    await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-blue")
    await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-red")

    await openCanvas(page)
    await focusWorkspace(page)
    await page.keyboard.press("Meta+z")
    await expect(rows.nth(1)).toHaveAttribute("data-tree-id", "node-red")
    await expect(rows.nth(2)).toHaveAttribute("data-tree-id", "node-blue")
  })
})

test("mounts the Godot 2D workspace with the canonical panels and no mode bar", async ({
  page,
}) => {
  await page.goto("/")

  await expect(page.getByTestId("workspace-project-title")).toHaveText("新建游戏项目")
  await expect(page.getByTestId("workspace-run")).toBeVisible()
  await expect(page.getByTestId("workspace-save")).toBeVisible()
  for (const title of ["Scene", "Canvas", "Inspector"]) {
    await expect(page.getByRole("tab", { name: title })).toBeVisible()
  }
  await expect(page.getByRole("navigation", { name: "Editor modes" })).toHaveCount(0)
  await expect(page.getByRole("complementary", { name: "Component tree" })).toBeVisible()
  await openCanvas(page)
  await expect(page.getByRole("region", { name: "Page board" })).toBeVisible()
  const workspaceBox = await page.getByTestId("workspace").boundingBox()
  if (workspaceBox === null) throw new Error("canvas workspace was not rendered")
  expect(workspaceBox.width).toBeGreaterThan(600)
  expect(workspaceBox.height).toBeGreaterThan(450)
  const toolbarBox = await page.locator(".composeui-editor__toolbar").boundingBox()
  const canvasBox = await page.getByRole("region", { name: "Canvas" }).boundingBox()
  const sceneBox = await page.getByRole("region", { name: "Scene" }).boundingBox()
  if (toolbarBox === null || canvasBox === null || sceneBox === null) {
    throw new Error("workspace panel chrome was not rendered")
  }
  expect(toolbarBox.x).toBeGreaterThanOrEqual(sceneBox.x + sceneBox.width - 1)
  expect(toolbarBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1)
  expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1)
  const createNodeBox = await page.getByTestId("create-node").boundingBox()
  const treeRowBox = await page.getByTestId("tree-row-node-blue").boundingBox()
  if (createNodeBox === null) throw new Error("create node command was not rendered")
  if (treeRowBox === null) throw new Error("tree row was not rendered")
  expect(createNodeBox.x).toBeGreaterThanOrEqual(sceneBox.x - 1)
  expect(createNodeBox.x + createNodeBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + 1)
  expect(treeRowBox.x).toBeLessThanOrEqual(sceneBox.x + 16)
  expect(treeRowBox.x + treeRowBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width + 1)
  const treeOverflow = await page.locator(".composeui-editor__component-tree").evaluate((tree) => ({
    clientWidth: tree.clientWidth,
    scrollLeft: tree.scrollLeft,
    scrollWidth: tree.scrollWidth,
  }))
  expect(treeOverflow.scrollLeft).toBe(0)
  expect(treeOverflow.scrollWidth).toBeLessThanOrEqual(treeOverflow.clientWidth + 1)
  await expect(page.locator(".composeui-editor__toolbar")).not.toContainText("Create rectangle")
  for (const testId of ["toggle-page-overflow", "export-json", "reset-layout"]) {
    const button = page.getByTestId(testId)
    await expect(button.locator("svg")).toHaveCount(1)
    await expect(button).not.toHaveText(/Show outside canvas|Export JSON|Reset layout/)
  }
})

test("selects a Scene node, edits its Inspector name, and undoes and redoes the rename", async ({
  page,
}) => {
  await page.goto("/")
  await openScene(page)
  await page.getByTestId("tree-node-red").click()
  await page.getByRole("tab", { name: "Inspector" }).click()
  const inspectorName = page.getByTestId("inspector-name")
  await expect(inspectorName).toHaveValue("Red rectangle")
  await expect(page.getByTestId("inspector-type")).toHaveText("node")

  await inspectorName.fill("Renamed rectangle")
  await inspectorName.press("Enter")
  await expect(page.getByTestId("tree-node-red")).toHaveText("Renamed rectangle")
  await expect(inspectorName).toHaveValue("Renamed rectangle")

  await openCanvas(page)
  await focusWorkspace(page)
  await page.keyboard.press("Meta+z")
  await expect(page.getByTestId("tree-node-red")).toHaveText("Red rectangle")
  await page.keyboard.press("Control+y")
  await expect(page.getByTestId("tree-node-red")).toHaveText("Renamed rectangle")
})

test("closes the Inspector from the visible Dockview tab without showing a panel menu", async ({
  page,
}) => {
  await page.goto("/")
  const tab = page.getByRole("tab", { name: "Inspector" })
  await expect(tab).toBeVisible()
  await expect(page.getByTestId("workspace-panel-menu")).toHaveCount(0)
  await tab.press("Delete")
  await expect(page.getByRole("tab", { name: "Inspector" })).toHaveCount(0)
})

test("persists a closed History panel across reload", async ({ page }) => {
  await page.goto("/")
  const historyTab = page.getByRole("tab", { name: "History" })
  await expect(historyTab).toBeVisible()
  await historyTab.press("Delete")
  await expect(page.getByRole("tab", { name: "History" })).toHaveCount(0)
  await expect(
    page.evaluate(() => localStorage.getItem("composeui:workspace:2d:v2")),
  ).resolves.not.toContain('"component":"history"')
  await page.reload()
  await expect(page.getByRole("tab", { name: "History" })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "Canvas" })).toBeVisible()
})

test("falls back to the canonical workspace when persisted layout JSON is corrupted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("composeui:workspace:2d:v2", "{not valid json")
  })
  await page.goto("/")

  await expect(page.getByRole("tab", { name: "Scene" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Canvas" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Inspector" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible()
})

test("resets the Dockview layout without changing canonical document JSON", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("export-json").click()
  const output = page.getByTestId("canonical-json-output")
  const before = await output.textContent()

  const inspectorTab = page.getByRole("tab", { name: "Inspector" })
  await inspectorTab.press("Delete")
  await page.getByTestId("reset-layout").click()
  await expect(page.getByRole("tab", { name: "Inspector" })).toBeVisible()
  await page.getByTestId("export-json").click()
  await expect(output).toHaveText(before ?? "")
})

test("runs workspace commands for creation, grid, overflow, and canonical export", async ({
  page,
}) => {
  await page.goto("/")
  const grid = page.getByTestId("toggle-grid")
  const initialGridState = await grid.getAttribute("aria-pressed")
  await grid.click()
  await expect(grid).toHaveAttribute("aria-pressed", initialGridState === "true" ? "false" : "true")
  await grid.click()
  await expect(grid).toHaveAttribute("aria-pressed", initialGridState ?? "true")

  await page.getByTestId("create-node").click()
  await expect(page.locator("[data-node-id='node-created-1']")).toBeVisible()
  await page.getByTestId("toggle-page-overflow").click()
  await expect(page.getByTestId("toggle-page-overflow")).toHaveAttribute("aria-pressed", "false")

  await page.getByTestId("export-json").click()
  await expect(page.getByTestId("canonical-json-output")).toContainText('"node-created-1"')
  await expect(page.getByTestId("canonical-json-output")).not.toContainText("gridVisible")
  await expect(page.getByTestId("canonical-json-output")).not.toContainText("selection")
})

async function assertViewportLayout(page: Page) {
  const viewport = page.viewportSize()
  const host = await page.locator(".composeui-editor__workspace-host").boundingBox()
  const shell = await page.locator(".composeui-editor__workspace-shell").boundingBox()
  if (viewport === null || host === null || shell === null) {
    throw new Error("workspace host was not rendered")
  }
  expect(host.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(shell.width).toBeGreaterThanOrEqual(viewport.width - 1)

  const toolbar = await page.locator(".composeui-editor__toolbar").boundingBox()
  const dockview = await page.locator(".composeui-editor__dockview-host").boundingBox()
  const canvas = await page.getByRole("region", { name: "Canvas" }).boundingBox()
  if (toolbar === null || dockview === null || canvas === null) {
    throw new Error("workspace layout was not rendered")
  }

  const rectangles = async (selector: string) =>
    page.locator(selector).evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = getComputedStyle(element)
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
        })
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            group: (() => {
              const tablist = element.closest("[role='tablist']")
              if (tablist === null) return "panel"
              const tablistRect = tablist.getBoundingClientRect()
              return `${tablistRect.x}:${tablistRect.y}:${tablistRect.width}:${tablistRect.height}`
            })(),
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        })
        .filter((rect) => rect.width > 0 && rect.height > 0),
    )
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const assertNoOverlap = (
    name: string,
    boxes: Array<{
      x: number
      y: number
      right: number
      bottom: number
      width: number
      height: number
      group: string
    }>,
  ) => {
    expect(boxes.length, `${name} should render visible rectangles`).toBeGreaterThan(0)
    for (let index = 0; index < boxes.length; index += 1) {
      for (let next = index + 1; next < boxes.length; next += 1) {
        const left = boxes[index]!
        const right = boxes[next]!
        if (left.group !== right.group) continue
        const overlaps =
          left.x < right.right &&
          left.right > right.x &&
          left.y < right.bottom &&
          left.bottom > right.y
        expect(overlaps, `${name} rectangles ${index} and ${next} overlap`).toBe(false)
      }
    }
  }

  expect(toolbar.y).toBeGreaterThanOrEqual(dockview.y - 1)
  expect(toolbar.x).toBeGreaterThanOrEqual(canvas.x - 1)
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1)
  assertNoOverlap("Dockview panels", await rectangles(".dv-groupview"))
  assertNoOverlap("Dockview tabs", await rectangles(".dv-tab"))
}

test("keeps the workspace panels within a 1440x900 viewport without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await assertViewportLayout(page)
})

test("keeps the workspace panels within a 900x700 viewport without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto("/")
  await assertViewportLayout(page)
})
