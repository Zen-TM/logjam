// Its own module so the integration suite can upload to it without loading
// the service, which reads the environment as it loads.

/**
 * In the topo bucket, outside `master/`: `master/*` is the only prefix the
 * CDN serves (envs/prod/s3_policies.tf), and this file is read by the API
 * alone. It is derived from public data, but every lookup goes through an
 * authenticated route so that where people look is ours to keep.
 */
export const FLOW_NETWORK_KEY = "private/flow-network/flow-network.gpkg";
