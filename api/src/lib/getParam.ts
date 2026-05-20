// Express 5 types `req.params[key]` as `string | string[]` because wildcard
// route segments (e.g. `/foo/*id`) bind to `string[]`. None of our routes use
// wildcard params, so in practice the value is always a string — but the
// compiler can't prove that, hence this narrowing helper.
export function getParam(param: string | string[]): string {
  return Array.isArray(param) ? param[0] : param;
}
