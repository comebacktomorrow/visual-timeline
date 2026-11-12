import { test, expect } from '@grafana/plugin-e2e';

// Video clips (M10c): TestData rows with a video field, the clips small VP9
// WebM files the folder fixture's nginx serves (tests/folder-fixture/video).
// cam-v takes a frame a minute and has a clip from 10:06 to 10:12 (with a
// larger version); cam-w has only clips, 10:00 to 10:20.

test('a clip plays over the frames in the player, and a host of clips opens on its video', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  // tall enough that the panel, last on the dashboard, renders without
  // scrolling (Grafana 12 leaves panels below the fold unrendered)
  await page.setViewportSize({ width: 1280, height: 2600 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Video clips from TestData');
  const cards = panel.locator.locator('.ktl .card');
  await expect(cards).toHaveCount(2, { timeout: 20000 });
  const [camV, camW] = [cards.nth(0), cards.nth(1)];
  // the strip keeps cam-v's frames, with a line where it has video; cam-w's
  // clips are bands of their own
  await expect(camV.locator('.slot img[src]').first()).toBeAttached({ timeout: 20000 });
  await expect(camV.locator('.clips .cliplane')).toHaveCount(1);
  await expect(camV.locator('.slot.clip')).toHaveCount(0);
  await expect(camW.locator('.slot.clip')).toHaveCount(2);

  // the window is 09:58 to 10:30: 10:09 is inside cam-v's clip
  const strip = camV.locator('.strip');
  const box = (await strip.boundingBox())!;
  const x = box.x + box.width * (11 / 32);
  const player = page.locator('.ktl-pop.player');
  await expect(async () => {
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.click(x, box.y + box.height / 2);
    await expect(player).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect(player).toHaveClass(/\bvideo\b/);
  const video = player.locator('.stage video:not(.spare)');
  // the larger version, muted, and the browser can play it
  await expect(video).toHaveAttribute('src', /clip-a-hi\.webm$/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  // seeked to 10:09's place in the clip: half way through 10:06 to 10:12
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration), { timeout: 5000 }).toBeGreaterThan(0.4);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime / v.duration)).toBeLessThan(0.6);
  // Play plays it; the dashboard's crosshair stays where it was
  const cursor = await page.locator('.ktl .acur').first().textContent();
  await player.locator('button[data-a="play"]').click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 5000 }).toBe(true);
  await expect(page.locator('.ktl .acur').first()).toHaveText(cursor!);
  // SD: the smaller version
  await player.locator('button[data-a="hd"]').click();
  await expect(video).toHaveAttribute('src', /clip-a\.webm$/);
  await page.keyboard.press('Escape');
  await expect(player).toHaveCount(0);

  // a band of cam-w's: the player opens on the clip, with no frame
  const wBox = (await camW.locator('.strip').boundingBox())!;
  // 10:03: inside the slot whose tick (10:00) shows clip-w1, clear of the
  // edge at 10:05 where the next slot (and clip) begins
  const wx = wBox.x + wBox.width * (5 / 32);
  await expect(async () => {
    await page.mouse.move(wx, wBox.y + wBox.height / 2);
    await page.mouse.click(wx, wBox.y + wBox.height / 2);
    await expect(player).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect(player.locator('.stage video:not(.spare)')).toHaveAttribute('src', /clip-w1\.webm$/);
  // no larger version: no HD button
  await expect(player.locator('button[data-a="hd"]')).toBeHidden();
  await expect(player.locator('button[data-a="play"]')).toBeEnabled();
});
