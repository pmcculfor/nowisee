import { requiredEnv } from "../appEnv.ts";
import { runAppMain } from "../serve.ts";
import { startAccountApp } from "./index.ts";

const app = startAccountApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
