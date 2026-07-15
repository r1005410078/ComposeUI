import { expect, test, type Locator, type Page } from "@playwright/test"

async function dispatchPointer(
  target: Locator,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
) {
  await target.dispatchEvent(type, {
    bubbles: true,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    pointerType: "mouse",
  })
}

async function dispatchWindowPointer(
  page: Page,
  type: "pointermove" | "pointerup",
  point: { x: number; y: number },
) {
  await page.evaluate(
    ({ eventType, eventPoint }) =>
      window.dispatchEvent(
        new PointerEvent(eventType, {
          bubbles: true,
          button: 0,
          clientX: eventPoint.x,
          clientY: eventPoint.y,
          pointerId: 1,
          pointerType: "mouse",
        }),
      ),
    { eventType: type, eventPoint: point },
  )
}

async function waitForOutputRowsToSettle(page: Page) {
  let previousCount = -1
  await expect
    .poll(async () => {
      const count = await page.getByTestId("output-entry").count()
      const settled = count === previousCount
      previousCount = count
      return settled
    })
    .toBe(true)
}

test("replays the final operation after reload without mutating the source session", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("create-node").click()
  await expect(page.getByTestId("tree-node-created-1")).toBeVisible()
  await page.reload()

  await page.getByRole("tab", { name: "输出" }).click()
  const documentEntries = page.locator("[data-testid='output-entry'][data-category='document']")
  await expect(documentEntries.last()).toBeVisible()
  const eventCount = await page.getByTestId("output-entry").count()
  await page.evaluate(() => {
    const rows = document.querySelectorAll<HTMLElement>(
      "[data-testid='output-entry'][data-category='document']",
    )
    const row = rows[rows.length - 1]
    if (row === null) throw new Error("FINAL_DOCUMENT_EVENT_MISSING")
    row.click()
    document.querySelector<HTMLButtonElement>("[data-testid='output-replay']")?.click()
  })
  await expect(page.getByTestId("replay-host")).not.toHaveAttribute("hidden")
  await page.getByTestId("replay-verify").click()

  await expect(page.getByTestId("replay-summary")).toContainText("状态：completed")
  await expect(page.getByTestId("replay-summary")).toContainText("一致")
  await expect(page.getByTestId("replay-difference")).toHaveCount(0)
  await expect(page.getByTestId("output-entry")).toHaveCount(eventCount)
})

test("replays a pointer-driven node move through the persisted operation bundle", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByTestId("create-node").click()
  await expect(page.getByTestId("tree-node-created-1")).toBeVisible()

  const sourceNode = page.locator("[data-node-id='node-blue']")
  await expect(sourceNode).toBeVisible()
  const sourcePosition = await sourceNode.evaluate((node) => {
    const style = getComputedStyle(node)
    return { left: Number.parseFloat(style.left), top: Number.parseFloat(style.top) }
  })
  expect(Number.isFinite(sourcePosition.left)).toBe(true)
  expect(Number.isFinite(sourcePosition.top)).toBe(true)

  const sourceBox = await sourceNode.boundingBox()
  if (sourceBox === null) throw new Error("SOURCE_NODE_NOT_RENDERED")
  const start = { x: sourceBox.x + 24, y: sourceBox.y + 24 }
  const target = { x: start.x + 40, y: start.y }
  await dispatchPointer(sourceNode, "pointerdown", start)
  await dispatchWindowPointer(page, "pointermove", target)
  await dispatchWindowPointer(page, "pointerup", target)
  await expect(sourceNode).toHaveCSS("left", `${sourcePosition.left + 40}px`)

  await page.reload()
  await expect(sourceNode).toHaveCSS("left", `${sourcePosition.left}px`)
  await page.getByRole("tab", { name: "输出" }).click()
  const moveEntry = page
    .locator("[data-testid='output-entry'][data-category='document']")
    .filter({ hasText: "移动“node-blue”" })
    .last()
  await expect(moveEntry).toBeVisible()
  const list = page.getByTestId("output-list")

  await list.evaluate((list) => {
    list.style.maxHeight = "64px"
    list.scrollTop = 100
  })
  await moveEntry.evaluate((row) => (row as HTMLElement).click())
  await waitForOutputRowsToSettle(page)
  await moveEntry.evaluate((row) => (row as HTMLElement).click())
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(100)
  await expect(page.getByTestId("output-replay")).toBeVisible()
  const eventCountBeforeReplay = await page.getByTestId("output-entry").count()
  await page.getByTestId("output-replay").click()

  await expect(page.getByTestId("replay-canvas-banner")).toContainText("回放预览")
  await expect(sourceNode).toHaveCSS("left", `${sourcePosition.left}px`)
  await expect(sourceNode).toHaveCSS("left", `${sourcePosition.left + 40}px`)
  await expect(page.getByTestId("replay-summary")).toContainText("状态：completed")
  await expect(page.getByTestId("output-entry")).toHaveCount(eventCountBeforeReplay)

  await page.getByTestId("replay-stop").click()
  await expect(page.getByTestId("replay-canvas-banner")).toHaveCount(0)
  await expect(sourceNode).toHaveCSS("left", `${sourcePosition.left}px`)
})

test("persists workspace panel activity across reload without mutating the canvas", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByTestId("tree-node-red")).toBeVisible()
  const canvasNodes = page.locator("[data-node-id]")
  const canvasNodeCount = await canvasNodes.count()
  expect(canvasNodeCount).toBeGreaterThan(0)

  const sceneTab = page.getByRole("tab", { name: "场景" })
  await sceneTab.focus()
  await page.keyboard.press("Backspace")
  await expect(sceneTab).toHaveCount(0)

  await page.getByRole("tab", { name: "输出" }).click()
  await page.getByTestId("output-filter-trigger").click()
  for (const category of ["document", "history", "session", "diagnostic", "system"])
    await page.locator(`[data-filter-category='${category}']`).click()
  await page.getByTestId("output-filter-close").click()
  const closedPanelEntry = page
    .locator("[data-testid='output-entry'][data-category='workspace']")
    .filter({ hasText: "关闭面板：scene" })
  await expect(closedPanelEntry).toBeVisible()

  await page.reload()
  await expect(page.getByRole("tab", { name: "场景" })).toHaveCount(0)
  await page.getByRole("tab", { name: "输出" }).click()
  await page.getByTestId("output-filter-trigger").click()
  for (const category of ["document", "history", "session", "diagnostic", "system"])
    await page.locator(`[data-filter-category='${category}']`).click()
  await page.getByTestId("output-filter-close").click()
  await expect(closedPanelEntry).toBeVisible()
  await expect(canvasNodes).toHaveCount(canvasNodeCount)
})
