import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { startGmailApp } from "./index.ts";

const app = startGmailApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
  dbPath: requiredEnv("NOWISEE_APP_DB"),
});
await runAppMain(app);
