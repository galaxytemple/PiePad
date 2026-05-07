import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    auth: vi.fn(),
    ensureRoom: vi.fn(),
    upsertRoomVisit: vi.fn(),
    getRoomById: vi.fn(),
    getRoomPasswordHash: vi.fn(),
    setRoomPasswordHash: vi.fn(),
    renameRoom: vi.fn(),
    deleteRoom: vi.fn(),
    deleteRoomWithAudit: vi.fn(),
    evictRoomFromWs: vi.fn(),
    setRoomUnlockCookie: vi.fn(),
    clearRoomUnlockCookie: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@piepad/db", () => ({
  ensureRoom: mocks.ensureRoom,
  upsertRoomVisit: mocks.upsertRoomVisit,
  getRoomById: mocks.getRoomById,
  getRoomPasswordHash: mocks.getRoomPasswordHash,
  setRoomPasswordHash: mocks.setRoomPasswordHash,
  renameRoom: mocks.renameRoom,
  deleteRoom: mocks.deleteRoom,
  deleteRoomWithAudit: mocks.deleteRoomWithAudit,
}));
vi.mock("@/lib/ws-internal", () => ({
  evictRoomFromWs: mocks.evictRoomFromWs,
}));
vi.mock("@/lib/room-unlock", () => ({
  setRoomUnlockCookie: mocks.setRoomUnlockCookie,
  clearRoomUnlockCookie: mocks.clearRoomUnlockCookie,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  adminDeleteRoomAction,
  createRoomAction,
  deleteRoomAction,
  renameRoomAction,
  setRoomPasswordAction,
  unlockRoomAction,
} from "./rooms";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

const SESSION_USER = { id: "42", email: "alice@example.com", isAdmin: false };
const SESSION_ADMIN = { id: "7", email: "root@example.com", isAdmin: true };
const ROOM_OWNED_BY_USER = {
  id: "abc",
  name: "Test",
  hasPassword: false,
  createdByUserId: 42,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
  }
  // Default: redirect throws so callers can detect "redirected" in tests.
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createRoomAction", () => {
  test("rejects when not signed in", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await createRoomAction(form({ name: "x" }));
    expect(result).toEqual({ ok: false, error: "unauthorized" });
    expect(mocks.ensureRoom).not.toHaveBeenCalled();
  });

  test("creates a room with the user as owner, no password", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    const result = await createRoomAction(form({ name: "Plan" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roomId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(mocks.ensureRoom).toHaveBeenCalledWith(result.roomId, "Plan", 42);
    expect(mocks.setRoomPasswordHash).not.toHaveBeenCalled();
    expect(mocks.upsertRoomVisit).toHaveBeenCalledWith(42, result.roomId);
  });

  test("hashes and stores a non-empty password", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    const result = await createRoomAction(
      form({ name: "Locked", password: "hunter2" })
    );
    expect(result.ok).toBe(true);
    expect(mocks.setRoomPasswordHash).toHaveBeenCalledTimes(1);
    const [roomIdArg, hashArg] = mocks.setRoomPasswordHash.mock.calls[0]!;
    expect(roomIdArg).toBe((result as { roomId: string }).roomId);
    expect(typeof hashArg).toBe("string");
    expect(hashArg).not.toBe("hunter2");
  });

  test("falls back to roomId as the name when name is blank", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    const result = await createRoomAction(form({ name: "  " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mocks.ensureRoom).toHaveBeenCalledWith(
      result.roomId,
      result.roomId,
      42
    );
  });
});

describe("renameRoomAction", () => {
  test("rejects when not signed in", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(
      renameRoomAction(form({ roomId: "abc", name: "x" }))
    ).rejects.toThrow("unauthorized");
  });

  test("rejects when caller is not the owner", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue({
      ...ROOM_OWNED_BY_USER,
      createdByUserId: 999,
    });
    await expect(
      renameRoomAction(form({ roomId: "abc", name: "Hacked" }))
    ).rejects.toThrow("forbidden");
    expect(mocks.renameRoom).not.toHaveBeenCalled();
  });

  test("renames when caller is the owner", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue(ROOM_OWNED_BY_USER);
    await renameRoomAction(form({ roomId: "abc", name: "New" }));
    expect(mocks.renameRoom).toHaveBeenCalledWith("abc", "New");
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });
});

describe("setRoomPasswordAction", () => {
  test("blank password clears the hash", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue(ROOM_OWNED_BY_USER);
    await setRoomPasswordAction(form({ roomId: "abc", password: "" }));
    expect(mocks.setRoomPasswordHash).toHaveBeenCalledWith("abc", null);
  });

  test("non-blank password hashes and stores", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue(ROOM_OWNED_BY_USER);
    await setRoomPasswordAction(form({ roomId: "abc", password: "secret" }));
    const [, hash] = mocks.setRoomPasswordHash.mock.calls[0]!;
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe("secret");
  });

  test("non-owner is forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue({
      ...ROOM_OWNED_BY_USER,
      createdByUserId: 999,
    });
    await expect(
      setRoomPasswordAction(form({ roomId: "abc", password: "x" }))
    ).rejects.toThrow("forbidden");
  });
});

describe("deleteRoomAction (owner)", () => {
  test("evicts ws then deletes, redirects home", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue(ROOM_OWNED_BY_USER);
    await expect(deleteRoomAction(form({ roomId: "abc" }))).rejects.toThrow(
      "__REDIRECT__:/?deleted=1"
    );
    expect(mocks.evictRoomFromWs).toHaveBeenCalledWith("abc", "owner_deleted");
    expect(mocks.deleteRoom).toHaveBeenCalledWith("abc");
    // Eviction must come before deletion so connected clients see the
    // banner before the row disappears.
    const evictOrder = mocks.evictRoomFromWs.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteRoom.mock.invocationCallOrder[0];
    expect(evictOrder).toBeLessThan(deleteOrder!);
  });

  test("non-owner is forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomById.mockResolvedValue({
      ...ROOM_OWNED_BY_USER,
      createdByUserId: 999,
    });
    await expect(
      deleteRoomAction(form({ roomId: "abc" }))
    ).rejects.toThrow("forbidden");
    expect(mocks.deleteRoom).not.toHaveBeenCalled();
  });
});

describe("adminDeleteRoomAction", () => {
  test("rejects non-admins even when authed", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    await expect(
      adminDeleteRoomAction(form({ roomId: "abc" }))
    ).rejects.toThrow("forbidden");
  });

  test("admin can delete a room they don't own", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_ADMIN });
    mocks.getRoomById.mockResolvedValue({
      id: "abc",
      name: "Some Room",
      hasPassword: false,
      createdByUserId: 999,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });
    await adminDeleteRoomAction(form({ roomId: "abc" }));
    expect(mocks.evictRoomFromWs).toHaveBeenCalledWith("abc", "admin_deleted");
    expect(mocks.deleteRoomWithAudit).toHaveBeenCalledWith(
      "abc",
      "Some Room",
      "ADMIN_DELETE"
    );
  });
});

describe("unlockRoomAction", () => {
  test("redirects to pad if room has no password", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    mocks.getRoomPasswordHash.mockResolvedValue(null);
    await expect(
      unlockRoomAction(form({ roomId: "abc", password: "" }))
    ).rejects.toThrow("__REDIRECT__:/pad/abc");
    expect(mocks.setRoomUnlockCookie).not.toHaveBeenCalled();
  });

  test("wrong password redirects with error param", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    // Use a real bcrypt hash so verifyPassword (real) compares fairly.
    const bcrypt = await import("bcrypt");
    mocks.getRoomPasswordHash.mockResolvedValue(
      await bcrypt.hash("right", 4)
    );
    await expect(
      unlockRoomAction(form({ roomId: "abc", password: "wrong" }))
    ).rejects.toThrow("__REDIRECT__:/pad/abc?password_error=1");
    expect(mocks.setRoomUnlockCookie).not.toHaveBeenCalled();
  });

  test("correct password sets unlock cookie + redirects to pad", async () => {
    mocks.auth.mockResolvedValue({ user: SESSION_USER });
    const bcrypt = await import("bcrypt");
    mocks.getRoomPasswordHash.mockResolvedValue(
      await bcrypt.hash("right", 4)
    );
    await expect(
      unlockRoomAction(form({ roomId: "abc", password: "right" }))
    ).rejects.toThrow("__REDIRECT__:/pad/abc");
    expect(mocks.setRoomUnlockCookie).toHaveBeenCalledWith("abc", 42);
  });
});
