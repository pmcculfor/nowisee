import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { startAccountApp } from "./index.ts";

const app = startAccountApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
