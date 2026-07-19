import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };

async function seed() {
  if (process.env.ENABLE_DEMO_SEED !== "true") {
    throw new Error(
      "Demo seeding is opt-in. Set ENABLE_DEMO_SEED=true to continue.",
    );
  }

  await prisma.note.createMany({
    data: [
      {
        title: "Welcome to Linked Notes",
        content: emptyDocument,
        contentText: "",
      },
      {
        title: "A fictional project idea",
        content: emptyDocument,
        contentText: "",
      },
    ],
    skipDuplicates: true,
  });
}

seed().finally(async () => prisma.$disconnect());
