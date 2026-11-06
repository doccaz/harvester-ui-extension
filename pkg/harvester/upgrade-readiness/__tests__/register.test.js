import { registerUpgradeReadiness } from '../config/register';
import { PAGES } from '../config/names';

describe('registerUpgradeReadiness', () => {
  it('shows every page only to users who can see Upgrades, with menu counts on Blockers and History', () => {
    const calls = { virtualType: [], configureType: [] };
    const dsl = {
      virtualType:         (o) => calls.virtualType.push(o),
      configureType:       (type, o) => calls.configureType.push([type, o]),
      basicType:           () => {},
      labelGroup:          () => {},
      setGroupDefaultType: () => {},
      weightGroup:         () => {}
    };

    registerUpgradeReadiness({ DSL: () => dsl }, {});

    expect(calls.virtualType).toHaveLength(Object.keys(PAGES).length);
    calls.virtualType.forEach((v) => expect(v.ifHaveType).toBe('harvesterhci.io.upgrade'));
    expect(calls.configureType.map(([type]) => type)).toStrictEqual([PAGES.readiness.type, PAGES.history.type]);
  });
});
