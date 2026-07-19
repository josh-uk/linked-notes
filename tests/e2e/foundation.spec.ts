import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("shows an accessible local notes workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Linked Notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All notes" })).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "All notes list" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
