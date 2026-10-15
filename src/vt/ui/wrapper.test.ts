import { makeWrapper, retireWrapper, revealWrapper } from './wrapper';

describe('revealWrapper', () => {
  test("a destroyed mount's late reveal leaves its successor alone", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const first = makeWrapper(root);
    const pending = revealWrapper(root, first); // still waiting for its images
    retireWrapper(first); // the panel tore it down (destroy)
    const second = makeWrapper(root);
    await revealWrapper(root, second);
    await pending; // the first mount's reveal finishes after its successor's
    expect(second.isConnected).toBe(true);
    expect(second.style.visibility).toBe('');
    root.remove();
  });

  test('a reveal swaps out every earlier wrapper', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const old = makeWrapper(root);
    const next = makeWrapper(root);
    await revealWrapper(root, next);
    expect(old.isConnected).toBe(false);
    expect([...root.children]).toEqual([next]);
    root.remove();
  });
});
