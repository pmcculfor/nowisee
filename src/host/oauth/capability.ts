import type { OAuthCapability } from "../../src/core/types.ts";
import type { OAuthBroker } from "./broker.ts";

export function bindOAuth(
  broker: OAuthBroker,
  args: {
    readonly userId: string | null;
    readonly sessionId: string;
    readonly appId: string;
  },
): OAuthCapability {
  return {
    start(opts) {
      return broker.start({
        userId: args.userId,
        sessionId: args.sessionId,
        appId: args.appId,
        slot: opts.slot,
        returnPath: opts.returnPath,
      });
    },
    status(slot) {
      return broker.status({ userId: args.userId, appId: args.appId, slot });
    },
    getAccessToken(slot) {
      return broker.getAccessToken({ userId: args.userId, appId: args.appId, slot });
    },
    disconnect(slot) {
      return broker.disconnect({ userId: args.userId, appId: args.appId, slot });
    },
  };
}
