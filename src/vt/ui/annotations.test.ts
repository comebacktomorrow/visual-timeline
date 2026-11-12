import { annTip, normAnnotations } from './annotations';

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

describe('the annotation tooltip', () => {
  const P = { from: 0, to: 1000 };
  const src = () => document.body.appendChild(document.createElement('div'));
  const tip = () => document.querySelector('.ktl-ann-tip') as HTMLElement;
  afterEach(() => annTip().close());

  test('routing tags (host:, source:, kiosk:, site:) are not shown; other tags are', () => {
    const items = normAnnotations([{ time: 10, title: 'Restart', tags: ['host:cam-1', 'source:cam-1', 'kiosk:cam-1', 'site:home', 'deploy'] }], P);
    annTip().show(items, 10, 10, src(), 'UTC');
    expect([...tip().querySelectorAll('.ag span')].map((s) => s.textContent)).toEqual(['deploy']);
  });

  test('text is text, never markup; only http(s) URLs become links', () => {
    const items = normAnnotations([{ time: 10, title: '<img src=x onerror=alert(1)>', text: 'see https://example.com/a and javascript:alert(1) <b>x</b>' }], P);
    annTip().show(items, 10, 10, src(), 'UTC');
    expect(tip().querySelector('img')).toBeNull();
    // the tooltip's own title is bold; the text's <b> stays text
    expect([...tip().querySelectorAll('b')].every((b) => b.children.length === 0)).toBe(true);
    expect(tip().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(tip().textContent).toContain('<b>x</b>');
    const links = [...tip().querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a']);
    expect(links[0].rel).toContain('noopener');
  });

  test('pinned, it stays until Escape or a click elsewhere', () => {
    const items = normAnnotations([{ time: 10, title: 'Pinned' }], P);
    annTip().pin(items, 10, 10, src(), 'UTC');
    annTip().hide();
    expect(tip().style.display).not.toBe('none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip().style.display).toBe('none');
  });
});
