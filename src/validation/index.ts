/**
 * Shared Validation Utilities
 *
 * Single source of truth for validation logic used across WXYC services.
 * Import in both frontend and backend to ensure consistent validation.
 */

/**
 * Result of a validation check
 */
export type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Email validation regex
 * Requires: local part, @, domain, dot, TLD
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check if a string is a valid email format
 *
 * @param email - The email string to validate
 * @returns true if valid email format, false otherwise
 *
 * @example
 * isValidEmail("user@example.com") // true
 * isValidEmail("invalid") // false
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") {
    return false;
  }
  return EMAIL_REGEX.test(email);
}

/**
 * Validate an email and return structured result
 *
 * @param email - The email string to validate
 * @returns ValidationResult with valid flag and optional error message
 *
 * @example
 * validateEmail("user@example.com") // { valid: true }
 * validateEmail("") // { valid: false, error: "Email is required" }
 */
export function validateEmail(email: string): ValidationResult {
  // Handle null/undefined
  if (email == null) {
    return { valid: false, error: "Email is required" };
  }

  // Handle non-strings
  if (typeof email !== "string") {
    return { valid: false, error: "Email must be a string" };
  }

  // Trim whitespace
  const trimmed = email.trim();

  // Check for empty
  if (trimmed.length === 0) {
    return { valid: false, error: "Email is required" };
  }

  // Check format
  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: "Invalid email format" };
  }

  return { valid: true };
}
