import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

/** Header yang tidak boleh pernah muncul di log (ADR-0001 §7). PII di body ditambah per rute. */
export const REDAKSI_LOG = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-callback-token']",
  'res.headers["set-cookie"]',
  // Juga saat kode mencatat `{ headers: request.headers }` langsung (temuan QA 12 Nov).
  "headers.authorization",
  "headers.cookie",
  "headers['x-callback-token']",
  'headers["set-cookie"]',
];

const skemaHealth = z.object({ status: z.literal("ok") });

export interface OpsiApp {
  /** `false` di tes agar output bersih; default logger JSON pino dengan redaksi. */
  readonly logger?: boolean;
  /** Tujuan log (hanya untuk tes redaksi). Default: stdout. */
  readonly logStream?: NodeJS.WritableStream;
}

export function buatApp(opsi: OpsiApp = {}) {
  const logger: FastifyServerOptions["logger"] =
    opsi.logger === false
      ? false
      : {
          redact: { paths: REDAKSI_LOG, censor: "[disensor]" },
          ...(opsi.logStream ? { stream: opsi.logStream } : {}),
        };

  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Liveness saja. `/ready` (cek DB) menyusul setelah T-013.
  app.get("/health", { schema: { response: { 200: skemaHealth } } }, () => ({
    status: "ok" as const,
  }));

  return app;
}
