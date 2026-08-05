import { startShell } from "./shell/bootstrap.ts";

const mount = document.querySelector("#app");
if (!(mount instanceof HTMLElement)) {
  throw new Error("Nowisee: #app mount point missing");
}

startShell(mount);
