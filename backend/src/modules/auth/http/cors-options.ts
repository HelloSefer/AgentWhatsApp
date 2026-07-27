import type { CorsOptions } from "cors";
import { isTrustedOrigin } from "./trusted-origin";

export const trustedFrontendCorsOptions: CorsOptions = {
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Retry-After"],
  origin(origin, callback) {
    if (origin === undefined) {
      callback(null, false);
      return;
    }
    callback(null, isTrustedOrigin(origin) ? origin : false);
  },
};
