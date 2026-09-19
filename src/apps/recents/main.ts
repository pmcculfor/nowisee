import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { createRecentsApp } from "./index.ts";

const app = createRecentsApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
});
await runAppMain(app);
