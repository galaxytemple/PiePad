import { auth, signOut } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  colorFor,
  isValidPaletteColor,
  PALETTE,
} from "@/components/pad/types";
import {
  getUserById,
  updateUserColor,
  updateUserNickname,
} from "@piepad/db";
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

async function saveColor(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId)) throw new Error("invalid session");

  const raw = String(formData.get("color") ?? "auto");
  // "auto" / unknown values both reset to NULL so the runtime falls back to
  // the name-hashed default. Anything else must be a canonical PALETTE entry.
  const next =
    raw === "auto" ? null : isValidPaletteColor(raw) ? raw : null;
  await updateUserColor(userId, next);
  revalidatePath("/me");
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = Number(session.user.id);

  const profile = await getUserById(userId);
  if (!profile) redirect("/login");

  const displayedName = profile.nickname ?? profile.name ?? profile.email;
  const autoColor = colorFor(displayedName);
  // The picker shows the user's saved choice if any, otherwise highlights
  // the auto-derived colour so the form opens "showing what you actually get".
  const selectedColor = profile.colorPref ?? autoColor;
  const isAuto = profile.colorPref === null;

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

        <Card className="mt-6">
          <Card.Header className="flex flex-col items-start gap-1">
            <h2 className="text-lg font-semibold">Awareness color</h2>
            <p className="text-xs text-default-500">
              Your caret tint and pill colour for other viewers. &ldquo;Auto&rdquo;
              picks a stable colour from your nickname.
            </p>
          </Card.Header>
          <Card.Content>
            <form action={saveColor} className="flex flex-col gap-4">
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">Color</legend>

                <label className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value="auto"
                    defaultChecked={isAuto}
                    className="peer sr-only"
                  />
                  <span
                    className="flex h-9 items-center gap-2 rounded-full border border-divider bg-content1 px-3 text-sm peer-checked:border-foreground peer-checked:ring-2 peer-checked:ring-foreground"
                  >
                    <span
                      aria-hidden
                      className="h-4 w-4 rounded-full"
                      style={{ background: autoColor }}
                    />
                    Auto
                  </span>
                </label>

                {PALETTE.map((c) => (
                  <label key={c} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="color"
                      value={c}
                      defaultChecked={!isAuto && selectedColor === c}
                      className="peer sr-only"
                    />
                    <span
                      aria-label={c}
                      className="block h-9 w-9 rounded-full border border-divider transition peer-checked:scale-110 peer-checked:border-foreground peer-checked:ring-2 peer-checked:ring-foreground"
                      style={{ background: c }}
                    />
                  </label>
                ))}
              </fieldset>

              <div>
                <Button type="submit" variant="primary">
                  Save color
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
