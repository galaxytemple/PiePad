"use client";

import { createRoomAction } from "@/app/actions/rooms";
import {
  Button,
  Input,
  Modal,
  useOverlayState,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreatePadButton() {
  const state = useOverlayState();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    try {
      const result = await createRoomAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      state.close();
      router.push(`/pad/${result.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal state={state}>
      <Modal.Trigger>
        <Button variant="primary" size="sm">
          + New pad
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading className="text-lg font-semibold">
                Create a new pad
              </Modal.Heading>
            </Modal.Header>
            <form
              action={(fd) => {
                void onSubmit(fd);
              }}
            >
              <Modal.Body className="flex flex-col gap-4 overflow-visible p-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Name</span>
                  <Input
                    name="name"
                    type="text"
                    maxLength={200}
                    placeholder="Untitled pad"
                    autoFocus
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    Password (optional)
                  </span>
                  <Input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Leave blank for an open pad"
                  />
                  <span className="text-xs text-default-500">
                    Anyone signed in with this password can join. You (the owner)
                    never need it.
                  </span>
                </label>

                {error ? (
                  <p className="rounded-medium border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                    {error}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onPress={() => state.close()}
                  isDisabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={busy}
                >
                  {busy ? "Creating…" : "Create"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
