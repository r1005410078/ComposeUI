import { expect, test } from "@playwright/test"

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
