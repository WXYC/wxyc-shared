import { describe, it, expect } from "vitest";
import {
  EMAIL_REGEX,
  isValidEmail,
  validateEmail,
  type ValidationResult,
} from "../src/validation/index.js";

describe("EMAIL_REGEX", () => {
  it("should be a RegExp", () => {
    expect(EMAIL_REGEX).toBeInstanceOf(RegExp);
  });

  describe("valid emails", () => {
    it.each([
      "test@example.com",
      "user.name@domain.org",
      "user+tag@example.co.uk",
      "a@b.co",
      "test123@test-domain.com",
      "UPPERCASE@DOMAIN.COM",
    ])("should match valid email: %s", (email) => {
      expect(EMAIL_REGEX.test(email)).toBe(true);
    });
  });

  describe("invalid emails", () => {
    it.each([
      "plaintext",
      "@nodomain.com",
      "no@domain",
      "spaces in@email.com",
      "missing@.com",
      "",
      "double@@at.com",
    ])("should not match invalid email: %s", (email) => {
      expect(EMAIL_REGEX.test(email)).toBe(false);
    });
  });
});

describe("isValidEmail", () => {
  describe("returns true for valid emails", () => {
    it.each([
      "test@example.com",
      "user@wxyc.org",
      "dj.name@station.fm",
    ])("isValidEmail(%s) returns true", (email) => {
      expect(isValidEmail(email)).toBe(true);
    });
  });

  describe("returns false for invalid emails", () => {
    it.each([
      ["", "empty string"],
      ["notanemail", "no @ symbol"],
      ["missing@tld", "no domain extension"],
      ["@nolocal.com", "no local part"],
      ["spaces @email.com", "contains spaces"],
    ])("isValidEmail(%s) returns false (%s)", (email) => {
      expect(isValidEmail(email)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles null-ish values gracefully", () => {
      expect(isValidEmail(null as unknown as string)).toBe(false);
      expect(isValidEmail(undefined as unknown as string)).toBe(false);
    });

    it("handles non-string values gracefully", () => {
      expect(isValidEmail(123 as unknown as string)).toBe(false);
      expect(isValidEmail({} as unknown as string)).toBe(false);
    });
  });
});

describe("validateEmail", () => {
  describe("valid emails", () => {
    it("returns valid result for good email", () => {
      const result = validateEmail("test@example.com");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("invalid emails", () => {
    it("returns error for empty string", () => {
      const result = validateEmail("");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("required");
    });

    it("returns error for invalid format", () => {
      const result = validateEmail("notanemail");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("format");
    });

    it("returns error for email without domain extension", () => {
      const result = validateEmail("test@nodomain");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles null gracefully", () => {
      const result = validateEmail(null as unknown as string);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("handles undefined gracefully", () => {
      const result = validateEmail(undefined as unknown as string);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("trims whitespace before validation", () => {
      const result = validateEmail("  test@example.com  ");
      expect(result.valid).toBe(true);
    });
  });

  describe("return type", () => {
    it("satisfies ValidationResult type", () => {
      const validResult: ValidationResult = validateEmail("test@example.com");
      const invalidResult: ValidationResult = validateEmail("");

      expect(validResult).toHaveProperty("valid");
      expect(invalidResult).toHaveProperty("valid");
      expect(invalidResult).toHaveProperty("error");
    });
  });
});
