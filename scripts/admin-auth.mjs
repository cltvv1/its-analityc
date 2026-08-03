import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000;
const DEFAULT_LOCKOUT_MS = 30 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function passwordHash(value) {
  return createHash("sha256")
    .update(String(value ?? ""), "utf8")
    .digest();
}

export class AdminSessionManager {
  constructor(
    password,
    {
      sessionTtlMs = DEFAULT_SESSION_TTL,
      lockoutMs = DEFAULT_LOCKOUT_MS,
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
    } = {},
  ) {
    this.password = String(password ?? "");
    this.sessionTtlMs = sessionTtlMs;
    this.lockoutMs = lockoutMs;
    this.maxAttempts = maxAttempts;
    this.sessions = new Map();
    this.failedAttempts = 0;
    this.blockedUntil = 0;
  }

  get configured() {
    return this.password.length > 0;
  }

  authenticate(candidate, now = Date.now()) {
    if (!this.configured) return { status: "unconfigured" };
    if (now < this.blockedUntil) {
      return {
        status: "blocked",
        retryAfterMs: this.blockedUntil - now,
      };
    }

    const matches = timingSafeEqual(
      passwordHash(candidate),
      passwordHash(this.password),
    );
    if (!matches) {
      this.failedAttempts += 1;
      if (this.failedAttempts >= this.maxAttempts) {
        this.failedAttempts = 0;
        this.blockedUntil = now + this.lockoutMs;
        return { status: "blocked", retryAfterMs: this.lockoutMs };
      }
      return {
        status: "invalid",
        attemptsRemaining: this.maxAttempts - this.failedAttempts,
      };
    }

    this.failedAttempts = 0;
    this.blockedUntil = 0;
    this.cleanup(now);
    const token = randomBytes(32).toString("hex");
    const expiresAt = now + this.sessionTtlMs;
    this.sessions.set(token, expiresAt);
    return { status: "ok", token, expiresAt };
  }

  validate(token, now = Date.now()) {
    if (!token) return null;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt || expiresAt <= now) {
      if (expiresAt) this.sessions.delete(token);
      return null;
    }
    return { expiresAt };
  }

  revoke(token) {
    if (token) this.sessions.delete(token);
  }

  cleanup(now = Date.now()) {
    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(token);
    }
  }
}

export function bearerToken(authorization) {
  const match = String(authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}
