/**
 * Cluster-aware request helper. Standalone Harvester serves Steve at `/v1/...` and the Kubernetes API under `/k8s/clusters/local/`.
 * Embedded in Rancher the same paths live under `/k8s/clusters/<id>/`. Callers write the standalone form; this maps it.
 */
export function resolveUrl(url, multiCluster, clusterId) {
  if (!multiCluster || !clusterId) {
    return url;
  }
  if (url.startsWith('/k8s/clusters/local/')) {
    return `/k8s/clusters/${ clusterId }/${ url.slice('/k8s/clusters/local/'.length) }`;
  }
  if (url.startsWith('/k8s/')) {
    return url;
  }

  return `/k8s/clusters/${ clusterId }${ url.startsWith('/') ? '' : '/' }${ url }`;
}
/** `request({ url })` against the Harvester cluster the dashboard is currently showing. */
export function clusterRequest(store) {
  return (opts) => store.dispatch('management/request', {
    ...opts,
    url: resolveUrl(opts.url, !!store.getters['isMultiCluster'], store.getters['clusterId'] || null)
  });
}
