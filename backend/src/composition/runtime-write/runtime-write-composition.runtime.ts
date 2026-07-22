import { env } from "../../config/env";
import { createRuntimeWriteComposition } from "./create-runtime-write-composition";

/** One process-lifetime composition; construction performs no database I/O. */
export const runtimeWriteComposition = createRuntimeWriteComposition({
  mode: env.persistenceRuntimeOrderWritesEnabled ? "enabled" : "disabled",
});
