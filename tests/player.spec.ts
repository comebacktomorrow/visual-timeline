import { test, expect } from '@grafana/plugin-e2e';

// The preview player (M10): clicking a frame opens it with the slot's own
// timeline: the frames the slot holds. The folder fixture
// (tests/folder-fixture) has a frame about every 3 minutes, one per slot, so
// there is nothing to play or step through, only the neighbouring slots.

test('a click opens the player on the slot\'s own timeline; ‹‹ ›› move between slots; Esc closes it', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  const dashboard = await readProvisionedDashboard({ fileName: 'folder.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Folder with an HTML listing');
  const strip = panel.locator.locator('.ktl .card').first().locator('.strip');
  await expect(strip.locator('.slot img[src]').first()).toBeAttached({ timeout: 20000 });
  // the middle of the strip
  const box = (await strip.boundingBox())!;
  const player = page.locator('.ktl-pop.player');
  // a click that lands while the panel redraws (a busy machine) opens nothing:
  // click again until the player is there
  await expect(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(player).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // the scrubber is the slot's own timeline: here, one frame
  await expect(player.locator('.scrub .tick')).toHaveCount(1);
  for (const a of ['play', 'prev', 'next']) {await expect(player.locator(`button[data-a="${a}"]`)).toBeDisabled();}
  // the large image once it settles
  await expect(player.locator('.stage img')).toHaveAttribute('src', /_hi\.svg$/);
  // ‹‹ ›› move to the neighbouring slot
  // the title on top; the time of the frame shown below
  await expect(player.locator('.title')).toHaveText(/cam-a/);
  const cap = player.locator('.bar .time');
  const first = await cap.textContent();
  await player.locator('button[data-a="next-slot"]').click();
  await expect(cap).not.toHaveText(first!);
  await player.locator('button[data-a="prev-slot"]').click();
  await expect(cap).toHaveText(first!);
  await page.keyboard.press('Escape');
  await expect(player).toHaveCount(0);
  // Esc closed only the player: the dashboard is still there
  await expect(strip).toBeVisible();

  // Zoom: the dashboard's range becomes the slot, and the player closes
  await expect(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(player).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await player.locator('button[data-a="zoom"]').click();
  await expect(player).toHaveCount(0);
  // a few minutes of 2026-01-01, not the dashboard's 09:58 to 10:30
  await expect(page).toHaveURL(/from=2026-01-01T10:\d\d:\d\d\.000Z&to=2026-01-01T10:\d\d:\d\d\.000Z/);
  expect(page.url()).not.toContain('09:58');
});
