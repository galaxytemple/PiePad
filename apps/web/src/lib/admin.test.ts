import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isAdminEmail } from "./admin";
import { parseAdminEmails } from "@piepad/db";

const ORIGINAL = process.env.ADMIN_EMAILS;

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

describe("isAdminEmail", () => {
  test("returns false when ADMIN_EMAILS is unset", () => {
    expect(isAdminEmail("alice@example.com")).toBe(false);
  });

  test("returns false for null/undefined/empty input", () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  test("matches an email present in the list", () => {
    process.env.ADMIN_EMAILS = "alice@example.com,bob@example.com";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("bob@example.com")).toBe(true);
  });

  test("is case-insensitive", () => {
    process.env.ADMIN_EMAILS = "Alice@Example.com";
    expect(isAdminEmail("ALICE@example.COM")).toBe(true);
  });

  test("trims whitespace around entries", () => {
    process.env.ADMIN_EMAILS = "  alice@example.com  ,  bob@example.com  ";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("bob@example.com")).toBe(true);
  });

  test("rejects non-listed emails", () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    expect(isAdminEmail("eve@example.com")).toBe(false);
  });

  test("ignores empty entries from stray commas", () => {
    process.env.ADMIN_EMAILS = ",alice@example.com,,";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("")).toBe(false);
  });

  test("re-reads env when value changes (no stale cache)", () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    expect(isAdminEmail("alice@example.com")).toBe(true);
    expect(isAdminEmail("bob@example.com")).toBe(false);

    process.env.ADMIN_EMAILS = "bob@example.com";
    expect(isAdminEmail("alice@example.com")).toBe(false);
    expect(isAdminEmail("bob@example.com")).toBe(true);
  });
});

describe("parseAdminEmails", () => {
  test("returns empty array when input is empty or undefined", () => {
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  test("parses, trims, and lowercases comma-separated emails", () => {
    expect(
      parseAdminEmails("  Alice@Example.com , BOB@Example.COM  ")
    ).toEqual(["alice@example.com", "bob@example.com"]);
  });

  test("filters out empty entries from stray commas", () => {
    expect(parseAdminEmails(",,admin@example.com,,")).toEqual([
      "admin@example.com",
    ]);
  });

  test("defaults to process.env.ADMIN_EMAILS when no argument is given", () => {
    process.env.ADMIN_EMAILS = "root@example.com, superuser@example.com ";
    expect(parseAdminEmails()).toEqual([
      "root@example.com",
      "superuser@example.com",
    ]);
  });
});
