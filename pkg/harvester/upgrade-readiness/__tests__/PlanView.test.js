import { mount } from '@vue/test-utils';
import lab from './fixtures/lab-2026-11-06.json';
import mid from '../dev/mid-upgrade.json';
import PlanView from '../components/PlanView.vue';
import InfoTip from '../components/InfoTip.vue';

jest.mock('vuex', () => ({ useStore: () => ({ getters: { 'i18n/t': (key, args) => `${ key }${ args ? JSON.stringify(args) : '' }` } }) }));
jest.mock('vue-router', () => ({ useRoute: () => ({ params: { cluster: 'local' } }) }));

const stubs = {
  Banner:          { template: '<div class="banner"><slot /></div>' },
  CopyToClipboard: true,
  'router-link':   { props: ['to'], template: '<a><slot /></a>' }
};
const render = (snap) => mount(PlanView, { props: { snap }, global: { stubs } });

describe('planView', () => {
  it('lab today: verdict fails, steps 2 and 3 marked as likely to stall', () => {
    const w = render(lab);

    expect(w.find('.verdict').classes()).toContain('fail');
    expect(w.findAll('.track li').map((li) => li.classes().find((c) => ['ok', 'action', 'stall'].includes(c)))).toStrictEqual(['ok', 'ok', 'stall', 'stall']);
    expect(w.findAll('.step.stall')).toHaveLength(2);
    expect(w.find('.live').exists()).toBe(false);
  });

  it('mid-upgrade: live banner with phases, per-node state, migrations and the job log command', () => {
    const w = render(mid);

    expect(w.find('.live').exists()).toBe(true);
    expect(w.find('.verdict').exists()).toBe(false);
    expect(w.findAll('.live .track li').map((li) => li.classes()[0])).toStrictEqual(['done', 'done', 'done', 'done', 'running', 'pending']);
    const rows = w.findAll('.step:not(.services)');
    const row = (node) => rows.find((r) => r.find('h2').text().endsWith(node));
    const row01 = row('harv01lab');

    expect(row01.find('.live-state').text()).toBe('Pre-draining');
    expect(row01.text()).toContain('live.migrating');
    expect(row01.find('.copy code').text()).toBe('kubectl -n harvester-system logs job/hvst-upgrade-new-pre-drain-harv01lab --all-containers');
    expect(row('harv02lab').find('.live-state').classes()).toContain('paused');
  });

  it('moves "why this order" and the services text into info bubbles', () => {
    const w = render(lab);
    const texts = w.findAllComponents(InfoTip).map((c) => c.props('text'));

    expect(texts).toStrictEqual(expect.arrayContaining([expect.stringContaining('plan.why.text'), expect.stringContaining('plan.services.text')]));
    expect(w.find('details.why').exists()).toBe(false);
  });

  it('manual pauses: "read at start" is a bubble on the pause banner, not a note line', () => {
    const manual = { ...lab, upgradeConfig: { value: JSON.stringify({ nodeUpgradeOption: { strategy: { mode: 'manual', pauseNodes: ['harv02lab'] } } }) } };
    const w = render(manual);

    expect(w.find('.banner').findComponent(InfoTip).props('text')).toContain('plan.note.readAtStart');
    expect(w.find('.notes').text()).toContain('note.runsUntil');
    expect(w.find('.notes').text()).not.toContain('note.readAtStart');
  });
});
