import { prisma } from "../src/infrastructure/db/prismaClient";
import { DEMO_GYM_ID } from "../../scripts/demo-client-history";
import {
  DEMO_RECORD_DOCUMENTS,
  installDemoClientRecordDocuments,
  removeDemoClientRecordDocuments,
  verifyDemoClientRecordDocuments,
} from "../../scripts/demo-client-record-documents";

try {
  if (process.argv.includes("--remove")) {
    await removeDemoClientRecordDocuments(prisma, DEMO_GYM_ID);
    console.log("Fixture remota de emisiones eliminada.");
  } else {
    await installDemoClientRecordDocuments(prisma, DEMO_GYM_ID);
    const rows = await verifyDemoClientRecordDocuments(prisma, DEMO_GYM_ID);
    console.log(
      JSON.stringify(
        { motor: "MariaDB", esperados: DEMO_RECORD_DOCUMENTS.length, rows },
        null,
        2,
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}
