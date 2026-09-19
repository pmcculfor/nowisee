import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { startBibleApp } from "./index.ts";

const app = startBibleApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
