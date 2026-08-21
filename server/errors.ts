export class AppNotFoundError extends Error {
  readonly appId: string;
  constructor(appId: string) {
    super(`Unknown app "${appId}"`);
    this.appId = appId;
  }
}
