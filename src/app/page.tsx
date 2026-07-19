import { connection } from "next/server";

import { NoteWorkspace } from "@/features/notes/components/note-workspace";

export default async function Home() {
  await connection();
  return <NoteWorkspace />;
}
