// @ts-ignore — módulo compartido ESM en la raíz del repositorio.
import { applyDocumentTypeDemo } from "../../scripts/demo-document-types.mjs";
import { prisma } from "../src/infrastructure/db/prismaClient";

const gymId = process.env.DEMO_DOCUMENT_GYM_ID ?? "local-gym-001";

try {
  const syncEventsBefore = await prisma.syncLog.count();
  const result = await applyDocumentTypeDemo({
    prisma,
    gymId,
    sourceDevice: "DEMO_DOCUMENT_TYPES",
    remove: process.argv.includes("--remove"),
  });
  const syncEventsAfter = await prisma.syncLog.count();
  if (syncEventsAfter !== syncEventsBefore) {
    throw new Error("La fixture modificó sync_log; debe escribir sin eventos.");
  }
  console.log(JSON.stringify({
    ...result,
    sync_log_before: syncEventsBefore,
    sync_log_after: syncEventsAfter,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
