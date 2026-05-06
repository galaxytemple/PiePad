import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { timeAgo } from "./relative-time";

const NOW = new Date("2026-05-06T10:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo", () => {
  test("null/undefined → em-dash", () => {
    expect(timeAgo(null)).toBe("—");
    expect(timeAgo(undefined)).toBe("—");
  });

  test("future timestamps render as 'just now'", () => {
    expect(timeAgo(new Date(NOW + 5_000))).toBe("just now");
  });

  test("seconds bucket", () => {
    expect(timeAgo(new Date(NOW - 1_000))).toBe("1s ago");
    expect(timeAgo(new Date(NOW - 59_000))).toBe("59s ago");
  });

  test("minutes bucket", () => {
    expect(timeAgo(new Date(NOW - 60_000))).toBe("1m ago");
    expect(timeAgo(new Date(NOW - 59 * 60_000))).toBe("59m ago");
  });

  test("hours bucket", () => {
    expect(timeAgo(new Date(NOW - 60 * 60_000))).toBe("1h ago");
    expect(timeAgo(new Date(NOW - 23 * 60 * 60_000))).toBe("23h ago");
  });

  test("days bucket", () => {
    expect(timeAgo(new Date(NOW - 24 * 60 * 60_000))).toBe("1d ago");
    expect(timeAgo(new Date(NOW - 29 * 24 * 60 * 60_000))).toBe("29d ago");
  });

  test("months bucket", () => {
    expect(timeAgo(new Date(NOW - 30 * 24 * 60 * 60_000))).toBe("1mo ago");
  });

  test("years bucket", () => {
    expect(timeAgo(new Date(NOW - 365 * 24 * 60 * 60_000))).toMatch(/y ago$/);
  });
});
