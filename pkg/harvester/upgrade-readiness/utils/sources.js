/** API paths the pre-flight reads (standalone form; `clusterRequest` maps them in Rancher). No imports: the fixture generator imports this file directly. */
export const K8S = '/k8s/clusters/local';

export const SOURCES = {
  nodes:             `${ K8S }/api/v1/nodes`,
  upgrades:          `${ K8S }/apis/harvesterhci.io/v1beta1/namespaces/harvester-system/upgrades`,
  versions:          `${ K8S }/apis/harvesterhci.io/v1beta1/namespaces/harvester-system/versions`,
  upgradeConfig:     `${ K8S }/apis/harvesterhci.io/v1beta1/settings/upgrade-config`,
  checkerEnabled:    `${ K8S }/apis/harvesterhci.io/v1beta1/settings/upgrade-checker-enabled`,
  serverVersion:     `${ K8S }/apis/harvesterhci.io/v1beta1/settings/server-version`,
  managedCharts:     `${ K8S }/apis/management.cattle.io/v3/namespaces/fleet-local/managedcharts`,
  bundleDeployments: `${ K8S }/apis/fleet.cattle.io/v1alpha1/bundledeployments`,
  capiCluster:       `${ K8S }/apis/cluster.x-k8s.io/v1beta2/namespaces/fleet-local/clusters/local`,
  machines:          `${ K8S }/apis/cluster.x-k8s.io/v1beta2/namespaces/fleet-local/machines`,
  addons:            `${ K8S }/apis/harvesterhci.io/v1beta1/addons`,
  vmBackups:         `${ K8S }/apis/harvesterhci.io/v1beta1/virtualmachinebackups`,
  schedules:         `${ K8S }/apis/harvesterhci.io/v1beta1/schedulevmbackups`,
  lhVolumes:         `${ K8S }/apis/longhorn.io/v1beta2/namespaces/longhorn-system/volumes`,
  lhReplicas:        `${ K8S }/apis/longhorn.io/v1beta2/namespaces/longhorn-system/replicas`,
  vmis:              `${ K8S }/apis/kubevirt.io/v1/virtualmachineinstances`,
  vms:               `${ K8S }/apis/kubevirt.io/v1/virtualmachines`
};
