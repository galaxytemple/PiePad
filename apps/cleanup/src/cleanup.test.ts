import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    listExpiredRooms: vi.fn(),
    deleteRoomWithAudit: vi.fn(),
  },
}));

vi.mock("@piepad/db", () => dbMocks);

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { runCleanupOnce } from "./cleanup.js";

function makeRoom(id: string, daysIdle = 31) {
  return {
    id,
    name: `Room ${id}`,
    lastAccessedAt: new Date(Date.now() - daysIdle * 24 * 60 * 60 * 1000),
  };
}

beforeEach(() => {
  dbMocks.listExpiredRooms.mockReset();
  dbMocks.deleteRoomWithAudit.mockReset();
  fetchMock.mockReset().mockResolvedValue(
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runCleanupOnce", () => {
  test("no expired rooms → nothing deleted", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([]);
    const result = await runCleanupOnce();
    expect(result).toEqual({ scanned: 0, deleted: 0, failed: 0 });
    expect(dbMocks.deleteRoomWithAudit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("evicts ws BEFORE deleting the row", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([makeRoom("r1")]);
    await runCleanupOnce();
    const fetchOrder = fetchMock.mock.invocationCallOrder[0];
    const deleteOrder = dbMocks.deleteRoomWithAudit.mock.invocationCallOrder[0];
    expect(fetchOrder).toBeLessThan(deleteOrder!);
  });

  test("posts the right shape to /internal/evict", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([makeRoom("r1")]);
    await runCleanupOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/internal\/evict$/);
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-internal-secret"]).toBe(process.env.AUTH_SECRET);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ roomId: "r1", reason: "30_DAY_INACTIVITY" });
  });

  test("inserts an audit row with the right reason", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([
      makeRoom("r1"),
      makeRoom("r2"),
    ]);
    await runCleanupOnce();
    expect(dbMocks.deleteRoomWithAudit).toHaveBeenCalledTimes(2);
    expect(dbMocks.deleteRoomWithAudit).toHaveBeenCalledWith(
      "r1",
      "Room r1",
      "30_DAY_INACTIVITY"
    );
    expect(dbMocks.deleteRoomWithAudit).toHaveBeenCalledWith(
      "r2",
      "Room r2",
      "30_DAY_INACTIVITY"
    );
  });

  test("ws evict failure does not block the deletion", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([makeRoom("r1")]);
    fetchMock.mockRejectedValue(new Error("ws is down"));
    const result = await runCleanupOnce();
    expect(dbMocks.deleteRoomWithAudit).toHaveBeenCalledWith(
      "r1",
      "Room r1",
      "30_DAY_INACTIVITY"
    );
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("a per-room error counts as failed but does not abort the sweep", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([
      makeRoom("ok1"),
      makeRoom("bad"),
      makeRoom("ok2"),
    ]);
    dbMocks.deleteRoomWithAudit.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("FK violation or whatever");
    });
    const result = await runCleanupOnce();
    expect(result).toEqual({ scanned: 3, deleted: 2, failed: 1 });
    // ok2 still got processed even though `bad` failed
    expect(dbMocks.deleteRoomWithAudit).toHaveBeenCalledWith(
      "ok2",
      "Room ok2",
      "30_DAY_INACTIVITY"
    );
  });

  test("uses the configured ROOM_TTL_DAYS when querying expired rooms", async () => {
    process.env.ROOM_TTL_DAYS = "7";
    // re-import so the module-level constant re-reads env
    vi.resetModules();
    const fresh = await import("./cleanup.js");
    dbMocks.listExpiredRooms.mockResolvedValue([]);
    await fresh.runCleanupOnce();
    expect(dbMocks.listExpiredRooms).toHaveBeenCalledWith(7);
    delete process.env.ROOM_TTL_DAYS;
  });

  test("passes adminEmails to listExpiredRooms when provided", async () => {
    dbMocks.listExpiredRooms.mockResolvedValue([]);
    await runCleanupOnce(["admin@example.com"]);
    expect(dbMocks.listExpiredRooms).toHaveBeenCalledWith(30, 500, [
      "admin@example.com",
    ]);
  });
});
