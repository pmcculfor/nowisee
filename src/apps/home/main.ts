import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { startHomeApp } from "./index.ts";

const app = startHomeApp({
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
