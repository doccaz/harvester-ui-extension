import { clusterRequest, resolveUrl } from '../cluster-request';

describe('resolveUrl', () => {
  it('leaves standalone Harvester paths alone', () => {
    expect(resolveUrl('/v1/harvesterhci.io.upgrades', false, 'c-abc')).toBe('/v1/harvesterhci.io.upgrades');
    expect(resolveUrl('/k8s/clusters/local/api/v1/nodes', false, null)).toBe('/k8s/clusters/local/api/v1/nodes');
  });

  it('maps them under the cluster when embedded in Rancher', () => {
    expect(resolveUrl('/v1/harvesterhci.io.upgrades', true, 'c-abc')).toBe('/k8s/clusters/c-abc/v1/harvesterhci.io.upgrades');
    expect(resolveUrl('v1/nodes', true, 'c-abc')).toBe('/k8s/clusters/c-abc/v1/nodes');
    expect(resolveUrl('/k8s/clusters/local/api/v1/nodes', true, 'c-abc')).toBe('/k8s/clusters/c-abc/api/v1/nodes');
    expect(resolveUrl('/k8s/clusters/c-xyz/api/v1/nodes', true, 'c-abc')).toBe('/k8s/clusters/c-xyz/api/v1/nodes');
  });

  it('clusterRequest sends the mapped URL through management/request', async() => {
    const dispatch = jest.fn().mockResolvedValue({ items: [] });
    const store = { dispatch, getters: { isMultiCluster: true, clusterId: 'c-abc' } };

    await clusterRequest(store)({ url: '/v1/nodes', headers: { a: 1 } });
    expect(dispatch).toHaveBeenCalledWith('management/request', { url: '/k8s/clusters/c-abc/v1/nodes', headers: { a: 1 } });
  });
});
