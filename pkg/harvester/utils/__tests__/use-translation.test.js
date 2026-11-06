import { useTranslation } from '../use-translation';

// jest.setup mocks useI18n globally; this test is about the real one.
jest.unmock('@shell/composables/useI18n');

jest.mock('vuex', () => ({ useStore: () => ({ getters: { 'i18n/t': (key, args) => (key === 'q' ? `it's ${ args.x } <b>` : undefined) } }) }));

describe('useTranslation', () => {
  it('returns the string unescaped (Vue escapes it once when rendering)', () => {
    expect(useTranslation()('q', { x: 1 })).toBe("it's 1 <b>");
  });

  it('shows a missing key as %key% like the shell does', () => {
    expect(useTranslation()('missing')).toBe('%missing%');
  });
});
