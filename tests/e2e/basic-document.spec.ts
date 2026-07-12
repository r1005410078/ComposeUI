import { expect, test } from "@playwright/test"

test("renders the M1 editor workspace", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("editor-shell")).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Component tree" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Page board" })).toBeVisible()
  await expect(page.getByTestId("tree-node-red")).toHaveText("Red rectangle")
  await expect(page.getByTestId("tree-node-blue")).toHaveText("Blue rectangle")
  await expect(page.locator("[data-node-id='node-red']")).toHaveCSS(
    "background-color",
    "rgb(220, 38, 38)",
  )
  await expect(page.locator("[data-node-id='node-blue']")).toHaveCSS(
    "background-color",
    "rgb(37, 99, 235)",
  )
})
