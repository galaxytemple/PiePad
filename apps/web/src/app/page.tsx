import { CreatePadButton } from "@/components/CreatePadButton";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-5xl font-bold tracking-tight">PiePad</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Real-time collaborative notepad with code execution
      </p>
      <CreatePadButton />
    </main>
  );
}
