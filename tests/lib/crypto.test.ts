import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { SECRET_ENCRYPTION_KEY: "test-encryption-key-for-unit-tests" },
}));

describe("crypto", () => {
  let encrypt: (text: string) => string;
  let decrypt: (text: string) => string;

  beforeEach(async () => {
    const mod = await import("@/lib/crypto");
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  it("encrypts and decrypts a string round-trip", () => {
    const plaintext = "my-secret-value-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces format iv:authTag:ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(32);
    expect(parts[1]).toHaveLength(32);
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("produces different ciphertexts for same input (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("returns plaintext unchanged if no colons (legacy fallback)", () => {
    expect(decrypt("plaintext-no-colons")).toBe("plaintext-no-colons");
  });
});
