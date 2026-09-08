export class DevelopmentProxyPortConflictError extends Error {
  constructor(port: number) {
    super(`Portless proxy port ${port} is already in use`);
    this.name = "DevelopmentProxyPortConflictError";
  }
}
