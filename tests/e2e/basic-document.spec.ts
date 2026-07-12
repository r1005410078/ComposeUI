import { expect, test } from "@playwright/test"

test("renders the M1 editor workspace", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("tab", { name: "画布" }).click()

  await expect(page.getByRole("region", { name: "画布", exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "画布" })).toBeVisible()
  await page.getByRole("tab", { name: "场景" }).click()
  await expect(page.getByRole("complementary", { name: "节点树" })).toBeVisible()
  await page.getByRole("tab", { name: "画布" }).click()
  await expect(page.getByRole("region", { name: "页面画布" })).toBeVisible()
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

test("supports keyboard navigation and selection in the component tree", async ({ page }) => {
  await page.goto("/")

  const red = page.getByTestId("tree-node-red")
  await expect(page.getByTestId("tree-toggle-page-1")).toHaveAttribute("tabindex", "-1")
  await red.focus()
  await red.press("ArrowDown")
  await expect(page.getByTestId("tree-node-blue")).toBeFocused()
  await page.getByTestId("tree-node-blue").press("Enter")
  await expect(page.getByTestId("selection-node-blue")).toBeAttached()
  await page.getByTestId("tree-node-blue").press("Home")
  await expect(page.getByTestId("tree-page-1")).toBeFocused()
  await page.getByTestId("tree-page-1").press("End")
  await expect(page.getByTestId("tree-node-blue")).toBeFocused()
})
