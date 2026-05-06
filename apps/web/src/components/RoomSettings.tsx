"use client";

import {
  deleteRoomAction,
  renameRoomAction,
  setRoomPasswordAction,
} from "@/app/actions/rooms";
import {
  Button,
  Input,
  Modal,
  useOverlayState,
} from "@heroui/react";
import { useState } from "react";

interface Props {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
}

export function RoomSettings({ roomId, roomName, hasPassword }: Props) {
  const state = useOverlayState();

  return (
    <Modal state={state}>
      <Modal.Trigger>
        <Button size="sm" variant="outline" aria-label="Room settings">
          Settings
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading className="text-lg font-semibold">
                Pad settings
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-6">
              <RenameSection roomId={roomId} initialName={roomName} />
              <PasswordSection roomId={roomId} hasPassword={hasPassword} />
              <DeleteSection roomId={roomId} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function RenameSection({
  roomId,
  initialName,
}: {
  roomId: string;
  initialName: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Rename</h3>
      <form action={renameRoomAction} className="flex items-center gap-2">
        <input type="hidden" name="roomId" value={roomId} />
        <Input
          name="name"
          type="text"
          defaultValue={initialName}
          maxLength={200}
          required
          className="flex-1"
        />
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
      </form>
    </section>
  );
}

function PasswordSection({
  roomId,
  hasPassword,
}: {
  roomId: string;
  hasPassword: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Password</h3>
      <p className="text-xs text-default-500">
        {hasPassword
          ? "This pad is currently locked. Submit a new password to change it, or leave blank and submit to remove it."
          : "Add a password to require it for non-owner visitors."}
      </p>
      <form action={setRoomPasswordAction} className="flex items-center gap-2">
        <input type="hidden" name="roomId" value={roomId} />
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={
            hasPassword ? "New password (blank = remove)" : "Password"
          }
          className="flex-1"
        />
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
      </form>
    </section>
  );
}

function DeleteSection({ roomId }: { roomId: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="space-y-2 border-t border-divider pt-4">
      <h3 className="text-sm font-medium text-danger-600">Delete pad</h3>
      <p className="text-xs text-default-500">
        Permanent. Removes the document, snapshots, and visit history. Anyone
        currently editing will be evicted to read-only.
      </p>
      {confirming ? (
        <form action={deleteRoomAction} className="flex items-center gap-2">
          <input type="hidden" name="roomId" value={roomId} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onPress={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm">
            Yes, delete
          </Button>
        </form>
      ) : (
        <Button
          variant="danger-soft"
          size="sm"
          onPress={() => setConfirming(true)}
        >
          Delete pad
        </Button>
      )}
    </section>
  );
}
