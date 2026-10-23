// Sharpened areas: a LiDAR job whose output is the statewide terrain formats
// at the survey's own cell (topo/sharpen.py), instead of the styled layers of
// a legacy job.

/**
 * Whether /start marks a new job to sharpen. Off until Logjam Web draws
 * sharpened areas: merging to main deploys the API and the worker, and
 * before then a sharpened job's archives would draw on no client.
 */
export const SHARPEN_NEW_JOBS = false;
