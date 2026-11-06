import { HARVESTER_PRODUCT } from '../config/names';

/**
 * Router location for a fix target: a Harvester resource list/detail page (`resource`, `namespace`, `id`, `query`) or a
 * named Harvester page (`routeName`, e.g. `airgapupgrade` = upgrade from an uploaded ISO).
 */
export function location(target, cluster = 'local') {
  const base = { product: HARVESTER_PRODUCT, cluster };

  if (target.routeName) {
    return { name: `${ HARVESTER_PRODUCT }-c-cluster-${ target.routeName }`, params: base };
  }
  const params = { ...base, resource: target.resource };

  if (target.id && target.namespace) {
    return {
      name:   `${ HARVESTER_PRODUCT }-c-cluster-resource-namespace-id`,
      params: {
        ...params, namespace: target.namespace, id: target.id
      }
    };
  }
  if (target.id) {
    return {
      name: `${ HARVESTER_PRODUCT }-c-cluster-resource-id`, params: { ...params, id: target.id }, query: target.query || {}
    };
  }

  return { name: `${ HARVESTER_PRODUCT }-c-cluster-resource`, params };
}
