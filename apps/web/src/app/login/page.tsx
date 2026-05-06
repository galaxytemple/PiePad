import { signIn } from "@/auth";
import { Button, Card } from "@heroui/react";

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { callbackUrl, error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">PiePad</h1>
      <p className="text-default-500">Real-time collaborative notepad</p>

      <Card className="w-full max-w-sm">
        <Card.Header className="flex flex-col items-start gap-1 pb-0">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="text-sm text-default-500">
            Use a Google account to continue.
          </p>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {error ? (
            <p className="rounded-medium border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              Sign-in failed ({error}). Try again.
            </p>
          ) : null}

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl ?? "/" });
            }}
          >
            <Button type="submit" variant="outline" fullWidth>
              <GoogleMark />
              Continue with Google
            </Button>
          </form>
        </Card.Content>
      </Card>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
