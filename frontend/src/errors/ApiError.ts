export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly method: string,
    public readonly serverMessage?: string,
  ) {
    super(`API error ${status}: ${method} ${path}`);
    this.name = "ApiError";
  }
}
