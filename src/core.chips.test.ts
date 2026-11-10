import { headChips } from './vt/dom/html';

const decl = { site: 'home', location: 'porch', tags: { env: 'prod', room: 'entry' } };

describe('headChips (#126)', () => {
  test('without a list: the site with its location, then every tag, as always', () => {
    expect(headChips(decl, undefined)).toBe(
      '<span class="st" data-fk="site" data-fv="home">home · porch</span>' +
      '<span class="tags"><span class="st" data-fk="env" data-fv="prod">env=prod</span><span class="st" data-fk="room" data-fv="entry">room=entry</span></span>'
    );
  });
  test('with a list: only those, in its order; keys a host lacks are left out', () => {
    expect(headChips(decl, ['room', 'location', 'missing', 'site'])).toBe(
      '<span class="st" data-fk="room" data-fv="entry">room=entry</span>' +
      '<span class="st" data-fk="location" data-fv="porch">porch</span>' +
      '<span class="st" data-fk="site" data-fv="home">home</span>'
    );
  });
  test('values are escaped', () => {
    expect(headChips({ site: '<b>', tags: {} }, ['site'])).toBe('<span class="st" data-fk="site" data-fv="&#60;b&#62;">&#60;b&#62;</span>');
  });
});
