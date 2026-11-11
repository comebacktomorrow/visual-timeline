import { FRAME_WIDTH, frameWidthOf } from './frameWidth';

test('a mount\'s frame width: the default, or the panel\'s within bounds', () => {
  expect(frameWidthOf({})).toBe(FRAME_WIDTH);
  expect(frameWidthOf({ frameWidth: 12 })).toBe(12);
  expect(frameWidthOf({ frameWidth: 1 })).toBe(3);
  expect(frameWidthOf({ frameWidth: 500 })).toBe(48);
  expect(frameWidthOf({ frameWidth: NaN })).toBe(FRAME_WIDTH);
});
