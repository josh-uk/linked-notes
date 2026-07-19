import { expect, test } from "@playwright/test";

test("shows the local-first foundation", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Linked Notes" }),
  ).toBeVisible();
  await expect(page.getByText("Private and entirely local")).toBeVisible();
});
