import { requiredEnv } from "../appEnv.ts";
import { runAppMain } from "../serve.ts";
import { startBibleApp } from "./index.ts";

const app = startBibleApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
