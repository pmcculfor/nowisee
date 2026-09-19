import { requiredEnv } from "../appEnv.ts";
import { runAppMain } from "../serve.ts";
import { createRecentsApp } from "./index.ts";

const app = createRecentsApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
});
await runAppMain(app);
