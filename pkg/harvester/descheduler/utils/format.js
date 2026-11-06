const GIB = 1024 ** 3;

/** "62.4 GiB" */
export function formatBytes(bytes) {
  return `${ (bytes / GIB).toFixed(1) } GiB`;
}
/** "9.8 cores" (from millicores) */
export function formatCores(millis) {
  return `${ (millis / 1000).toFixed(1) } cores`;
}

/** "47.3%", "30%". One decimal, so a node at 29.6% is not shown as sitting on a 30% threshold. */
export function formatPct(v) {
  return `${ Number(v.toFixed(1)) }%`;
}
