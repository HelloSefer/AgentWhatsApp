import { createRuntimeReadComposition } from "./create-runtime-read-composition";
import { env } from "../../config/env";

/** Immutable application-level runtime-read composition. Construction performs no database I/O. */
export const runtimeReadComposition = createRuntimeReadComposition({
  mode: env.persistenceRuntimeReadsEnabled ? "enabled" : "disabled",
});
