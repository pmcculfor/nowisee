import { requiredEnv } from "../../node-kit/appEnv.ts";
import { runAppMain } from "../../node-kit/serve.ts";
import { createTutorialApp } from "./index.ts";

const app = createTutorialApp({
  rootAppId: requiredEnv("NOWISEE_ROOT_APP_ID"),
});
await runAppMain(app);
