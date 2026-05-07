import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Hoisted cookie jar + UA so the mock factory and the tests share one map.
const { cookieStore, requestState } = vi.hoisted(() => ({
  cookieStore: new Map<string, { value: string }>(),
  requestState: { userAgent: "test-ua/1.0" },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) =>
      cookieStore.set(name, { value }),
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "user-agent" ? requestState.userAgent : null,
  }),
}));

import {
  clearRoomUnlockCookie,
  isRoomUnlocked,
  setRoomUnlockCookie,
} from "./room-unlock";

beforeEach(() => {
  cookieStore.clear();
  requestState.userAgent = "test-ua/1.0";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("room-unlock cookie", () => {
  test("set + verify round-trip", async () => {
    await setRoomUnlockCookie("room1", 42);
    expect(await isRoomUnlocked("room1", 42)).toBe(true);
  });

  test("absent cookie → not unlocked", async () => {
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });

  test("rejects token bound to a different room", async () => {
    await setRoomUnlockCookie("room1", 42);
    // Pretend the same cookie were available for room2 — never happens via
    // path scoping in production, but verify the HMAC also enforces it.
    cookieStore.set("pad_unlock_room2", cookieStore.get("pad_unlock_room1")!);
    expect(await isRoomUnlocked("room2", 42)).toBe(false);
  });

  test("rejects token bound to a different user", async () => {
    await setRoomUnlockCookie("room1", 42);
    expect(await isRoomUnlocked("room1", 99)).toBe(false);
  });

  test("rejects a tampered hmac", async () => {
    await setRoomUnlockCookie("room1", 42);
    const cookie = cookieStore.get("pad_unlock_room1")!;
    cookieStore.set("pad_unlock_room1", { value: cookie.value + "ff" });
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });

  test("rejects malformed cookie value", async () => {
    cookieStore.set("pad_unlock_room1", { value: "not-a-token" });
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
    cookieStore.set("pad_unlock_room1", { value: "" });
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });

  test("rejects an expired cookie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    await setRoomUnlockCookie("room1", 42);

    // 25h later — past the 24h TTL
    vi.setSystemTime(new Date("2026-05-02T01:00:00Z"));
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });

  test("clearRoomUnlockCookie revokes access", async () => {
    await setRoomUnlockCookie("room1", 42);
    await clearRoomUnlockCookie("room1");
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });

  test("rejects token bound to a different user-agent", async () => {
    requestState.userAgent = "browser-A/1.0";
    await setRoomUnlockCookie("room1", 42);
    requestState.userAgent = "browser-B/1.0";
    expect(await isRoomUnlocked("room1", 42)).toBe(false);
  });
});
