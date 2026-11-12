import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

/** Header yang tidak boleh pernah muncul di log (ADR-0001 §7). PII di body ditambah per rute. */
const REDAKSI_LOG = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-callback-token']",
  'res.headers["set-cookie"]',
];

const skemaHealth = z.object({ status: z.literal("ok") });

export interface OpsiApp {
  /** `false` di tes agar output bersih; default logger JSON pino dengan redaksi. */
  readonly logger?: boolean;
}

export function buatApp(opsi: OpsiApp = {}) {
  const logger: FastifyServerOptions["logger"] =
    opsi.logger === false ? false : { redact: { paths: REDAKSI_LOG, censor: "[disensor]" } };

  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Liveness saja. `/ready` (cek DB) menyusul setelah T-013.
  app.get("/health", { schema: { response: { 200: skemaHealth } } }, () => ({
    status: "ok" as const,
  }));

  return app;
}
