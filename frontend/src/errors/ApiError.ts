export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: string;
  readonly serverMessage?: string;

  constructor(
    status: number,
    path: string,
    method: string,
    serverMessage?: string,
  ) {
    super(`API error ${status}: ${method} ${path}`);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.method = method;
    this.serverMessage = serverMessage;
  }
}
