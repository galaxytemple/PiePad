import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("passwords", () => {
  test("hash → verify round-trip succeeds", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(hash.length).toBeGreaterThan(20);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true
    );
  });

  test("verify fails with wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter1", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("hashes are non-deterministic (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });
});
