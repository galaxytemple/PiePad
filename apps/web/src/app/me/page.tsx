import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getUserById, updateUserNickname } from "@piepad/db";
import { Avatar, Button, Card, Input } from "@heroui/react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function saveNickname(formData: FormData): Promise<void> {
  "use server";
  // Re-derive identity from the session inside the action — never trust
  // closure-captured ids for authorisation. A user can only ever rename
  // themselves.
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw new Error("invalid session");

  const next = String(formData.get("nickname") ?? "").slice(0, 100);
  await updateUserNickname(userId, next);
  revalidatePath("/");
  revalidatePath("/me");
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);

  const profile = await getUserById(userId);
  if (!profile) redirect("/login");

  const displayedName = profile.nickname ?? profile.name ?? profile.email;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-divider bg-content1 px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold tracking-tight">PiePad</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/"
            className="text-sm text-default-500 hover:text-default-900"
          >
            ← Home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 p-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Profile</h1>

        <Card>
          <Card.Header className="flex items-center gap-4">
            <Avatar size="lg">
              {session.user.image ? (
                <Avatar.Image src={session.user.image} />
              ) : null}
              <Avatar.Fallback>
                {displayedName[0]?.toUpperCase() ?? "?"}
              </Avatar.Fallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{displayedName}</p>
              <p className="truncate text-sm text-default-500">
                {profile.email}
              </p>
              {session.user.isAdmin ? (
                <span className="mt-1 inline-block rounded bg-warning-100 px-1.5 py-0.5 text-xs font-medium text-warning-700">
                  admin
                </span>
              ) : null}
            </div>
          </Card.Header>

          <Card.Content>
            <form action={saveNickname} className="flex flex-col gap-3">
              <label htmlFor="nickname" className="flex flex-col gap-1">
                <span className="text-sm font-medium">Nickname</span>
                <span className="text-xs text-default-500">
                  Shown to other people in pads instead of your Google name.
                  Leave blank to fall back to {profile.name ?? profile.email}.
                </span>
                <Input
                  id="nickname"
                  name="nickname"
                  type="text"
                  maxLength={100}
                  defaultValue={profile.nickname ?? ""}
                  placeholder={profile.name ?? "Your nickname"}
                />
              </label>
              <div>
                <Button type="submit" variant="primary">
                  Save
                </Button>
              </div>
            </form>
          </Card.Content>
        </Card>

        <section className="mt-6">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button type="submit" variant="danger-soft">
              Sign out
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
