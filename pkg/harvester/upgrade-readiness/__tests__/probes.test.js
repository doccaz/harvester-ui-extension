import { METADATA_ONLY, PROBES, nodeProbes, runProbe } from '../utils/probes';

const probe = (id) => PROBES.find((p) => p.id === id);

describe('upgrade readiness probes', () => {
  it('asks for metadata only when reading plan secrets', () => {
    expect(probe('planSecretsMeta').headers).toBe(METADATA_ONLY);
  });

  it('flags plan secrets that came back with data', () => {
    const p = probe('planSecretsMeta');
    const meta = {
      kind:  'PartialObjectMetadataList',
      items: [{ metadata: { labels: { 'rke.cattle.io/init-node': 'true', 'rke.cattle.io/machine-name': 'custom-947' } } }]
    };

    expect(p.summary(meta)).toContain('data absent');
    expect(p.summary(meta)).toContain('init custom-947');
    expect(p.summary({ kind: 'SecretList', items: [{ metadata: {}, data: { token: 'x' } }] })).toContain('PRESENT');
  });

  it('never prints the serving cert itself', () => {
    expect(probe('servingCert').summary({ data: { 'tls.crt': 'LS0t' } })).toBe('tls.crt present');
  });

  it('builds two kubelet probes per node', () => {
    expect(nodeProbes(['a', 'b']).map((p) => p.id)).toStrictEqual(['stats:a', 'configz:a', 'stats:b', 'configz:b']);
    expect(nodeProbes(['a'])[0].summary({ node: { fs: { usedBytes: 40, capacityBytes: 100 } } })).toBe('fs 40% used');
  });

  it('reports failures without throwing', async() => {
    const r = await runProbe(() => Promise.reject(Object.assign(new Error('forbidden'), { _status: 403 })), probe('versions'));

    expect(r.ok).toBe(false);
    expect(r.detail).toBe('403 forbidden');
  });

  it('passes the probe headers to the request', async() => {
    const request = jest.fn().mockResolvedValue({ kind: 'PartialObjectMetadataList', items: [] });

    await runProbe(request, probe('planSecretsMeta'));
    expect(request).toHaveBeenCalledWith({ url: probe('planSecretsMeta').url, headers: METADATA_ONLY });
  });
});
