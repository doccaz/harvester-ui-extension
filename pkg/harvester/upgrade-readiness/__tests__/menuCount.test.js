import { menuCount, STALE_MS } from '../utils/menuCount';

// Run the getter, then let its background refresh (setTimeout 0 + the load promise) finish.
const settle = async() => {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('menuCount', () => {
  it('loads in the background when stale, and caches until STALE_MS', async() => {
    jest.useFakeTimers();
    const load = jest.fn().mockResolvedValue(4);
    const c = menuCount(load);
    const get = c.getter('store');

    expect(get()).toBeNull(); // never fetches inside the render
    expect(load).not.toHaveBeenCalled();
    await settle();
    expect(load).toHaveBeenCalledWith('store');
    jest.setSystemTime(Date.now() + STALE_MS - 1); // still fresh: served from the cache
    expect(get()).toBe(4);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 2);
    load.mockResolvedValue(5);
    get();
    await settle();
    expect(get()).toBe(5);
    expect(load).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('a page setting the count makes it fresh; a failed load keeps the last count and does not retry at once', async() => {
    jest.useFakeTimers();
    const load = jest.fn().mockRejectedValue(new Error('403'));
    const c = menuCount(load);

    c.set(2);
    expect(c.getter('s')()).toBe(2);
    expect(load).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + STALE_MS + 1);
    const get = c.getter('s');

    get();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(get()).toBe(2);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
