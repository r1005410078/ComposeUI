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

  await expect(page.getByTestId("replay-deterministic")).toHaveText("回放一致")
  await expect(page.getByTestId("replay-status")).toHaveText("completed")
  await expect(page.getByTestId("replay-difference")).toHaveCount(0)
  await expect(page.getByTestId("output-entry")).toHaveCount(eventCount)
})
