export type AccountFlowStore = {
  getEmail(sessionId: string): string | null;
  setEmail(sessionId: string, email: string): void;
  clear(sessionId: string): void;
};
