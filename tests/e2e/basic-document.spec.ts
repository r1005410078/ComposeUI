import { expect, test } from "@playwright/test"

test("renders the canonical M0 document", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("region", { name: "Page board" })).toBeVisible()
  await expect(page.locator("[data-node-id='node-1']")).toHaveCSS(
    "background-color",
    "rgb(37, 99, 235)",
  )
  await expect(page.getByLabel("Page document")).toContainText('"id": "node-1"')
})
