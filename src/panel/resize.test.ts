import { needsRebuild } from './resize';

describe('needsRebuild', () => {
  test('a scrollbar appearing or a few pixels of drag: the view just stretches', () => {
    expect(needsRebuild(1310, 1294)).toBe(false);
    expect(needsRebuild(1000, 1049)).toBe(false);
    expect(needsRebuild(1000, 1000)).toBe(false);
  });
  test('a real resize: rebuild for the new slot count and axis spacing', () => {
    expect(needsRebuild(1000, 940)).toBe(true);
    expect(needsRebuild(1000, 1200)).toBe(true);
  });
  test('the first real width after a zero-width start always builds', () => {
    expect(needsRebuild(0, 800)).toBe(true);
    expect(needsRebuild(0, 0)).toBe(false);
  });
});
