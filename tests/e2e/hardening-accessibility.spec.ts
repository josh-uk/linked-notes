import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function expectWcag22AA(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function createNote(request: APIRequestContext, title: string) {
  const response = await request.post("/api/notes", { data: { title } });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    id: string;
    optimisticVersion: number;
  };
}

test("enforces security headers and rejects stored active content", async ({
  page,
  request,
}) => {
  const title = `Stored content security ${Date.now()}`;
  const created = await createNote(request, title);
  const storedMarkup =
    "<img src=x onerror=\"document.body.dataset.compromised='true'\">";
  const save = await request.patch(`/api/notes/${created.id}`, {
    data: {
      expectedVersion: created.optimisticVersion,
      title,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: storedMarkup }],
          },
        ],
      },
    },
  });
  expect(save.status()).toBe(200);

  const unsafeLink = await request.patch(`/api/notes/${created.id}`, {
    data: {
      expectedVersion: (await save.json()).optimisticVersion,
      title,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  {
                    type: "link",
                    attrs: { href: "javascript:alert(document.domain)" },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  expect(unsafeLink.status()).toBe(400);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(response?.headers()).toMatchObject({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });

  await page.getByRole("option", { name: new RegExp(title) }).click();
  await expect(
    page.getByRole("textbox", { name: "Note content" }),
  ).toContainText(storedMarkup);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(
    await page
      .locator("body")
      .evaluate((element) => element.hasAttribute("data-compromised")),
  ).toBe(false);
});

test("meets WCAG 2.2 AA automation across themes and responsive widths", async ({
  page,
  request,
}) => {
  await createNote(request, `Responsive audit ${Date.now()}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".note-list")).toHaveAttribute(
    "aria-busy",
    "false",
  );

  await page.getByLabel("Colour theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectWcag22AA(page);
  await page.getByLabel("Colour theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectWcag22AA(page);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.locator(".note-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(
      await page
        .locator("html")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  await expectWcag22AA(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const duration = await page
    .getByRole("button", { name: "Create a new note" })
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThan(0.001);
});

test("traps and restores keyboard focus for organization and destructive dialogs", async ({
  page,
  request,
}) => {
  const title = `Dialog focus ${Date.now()}`;
  const created = await createNote(request, title);
  const trashed = await request.post(`/api/notes/${created.id}/actions`, {
    data: {
      action: "trash",
      expectedVersion: created.optimisticVersion,
    },
  });
  expect(trashed.status()).toBe(200);

  await page.goto("/");
  const manageFolders = page.getByRole("button", { name: "Manage folders" });
  await manageFolders.focus();
  await manageFolders.press("Enter");
  const organization = page.getByRole("dialog", { name: "Organize notes" });
  await expect(organization).toBeVisible();
  await expect(
    organization.getByRole("button", {
      name: "Close organization settings",
    }),
  ).toBeFocused();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await organization.evaluate((dialog) =>
        dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expectWcag22AA(page);
  await page.keyboard.press("Escape");
  await expect(organization).toBeHidden();
  await expect(manageFolders).toBeFocused();

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(title) }).click();
  const deleteTrigger = page.getByRole("button", {
    name: "Delete note permanently",
  });
  await deleteTrigger.focus();
  await deleteTrigger.press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Delete permanently?",
  });
  await expect(confirmation).toBeVisible();
  await expect(
    confirmation.getByRole("button", { name: "Keep note" }),
  ).toBeFocused();
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    expect(
      await confirmation.evaluate((dialog) =>
        dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expectWcag22AA(page);
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
});
