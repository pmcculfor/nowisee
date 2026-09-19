import { requiredEnv } from "../appEnv.ts";
import { runAppMain } from "../serve.ts";
import { startHomeApp } from "./index.ts";

const app = startHomeApp({
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
