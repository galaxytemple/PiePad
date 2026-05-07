import { unlockRoomAction } from "@/app/actions/rooms";
import { LockIcon } from "@/components/icons";
import { Button, Card, Input } from "@heroui/react";
import Link from "next/link";

interface Props {
  roomId: string;
  roomName: string;
  showError: boolean;
}

export function PasswordPrompt({ roomId, roomName, showError }: Props) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <Card.Header className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-2 text-default-500">
            <LockIcon />
            <span className="text-sm">Password required</span>
          </div>
          <h1 className="truncate text-xl font-semibold">{roomName}</h1>
          <p className="text-xs text-default-500">
            The owner has set a password on this pad.
          </p>
        </Card.Header>

        <Card.Content>
          <form action={unlockRoomAction} className="flex flex-col gap-3">
            <input type="hidden" name="roomId" value={roomId} />
            <Input
              name="password"
              type="password"
              autoFocus
              required
              placeholder="Pad password"
            />
            {showError ? (
              <p className="text-sm text-danger-600">
                Wrong password. Try again.
              </p>
            ) : null}
            <div className="flex items-center justify-between">
              <Link
                href="/"
                className="text-sm text-default-500 hover:text-default-900"
              >
                ← Home
              </Link>
              <Button type="submit" variant="primary">
                Unlock
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}
