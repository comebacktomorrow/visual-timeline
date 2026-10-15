import { normAnnotations } from './annotations';

describe('normAnnotations', () => {
  const P = { from: 0, to: 1000 };
  test.each(['host:cam-1', 'source:cam-1', 'kiosk:cam-1'])('a %s tag pins the annotation to that host', (tag) => {
    expect(normAnnotations([{ time: 10, tags: [tag] }], P)[0].source).toBe('cam-1');
  });
  test('a site: tag scopes it to a site; other tags pin nothing', () => {
    const [a] = normAnnotations([{ time: 10, tags: 'site:home, deploy' }], P);
    expect(a.siteScope).toBe('home');
    expect(a.source).toBeNull();
  });
});
