import { requiredEnv } from "../appEnv.ts";
import { runAppMain } from "../serve.ts";
import { startNotesApp } from "./index.ts";

const app = startNotesApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
