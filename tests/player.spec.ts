import { test, expect } from '@grafana/plugin-e2e';

// The preview player (M10): clicking a frame opens it with its own scrubber
// over the host's frames, previous and next, and play. Against the folder
// fixture (tests/folder-fixture): a frame about every 3 minutes.

test('a click opens the player: a tick per frame, previous and next, play, and Esc closes it', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
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
  await expect(player.locator('.scrub .tick').first()).toBeAttached();
  const cap = player.locator('.cap');
  const first = await cap.textContent();
  await player.locator('button[data-a="next"]').click();
  await expect(cap).not.toHaveText(first!);
  await player.locator('button[data-a="prev"]').click();
  await expect(cap).toHaveText(first!);
  // the large image once it settles
  await expect(player.locator('.stage img')).toHaveAttribute('src', /_hi\.svg$/);
  await player.locator('button[data-a="play"]').click();
  await expect(cap).not.toHaveText(first!, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(player).toHaveCount(0);
});
