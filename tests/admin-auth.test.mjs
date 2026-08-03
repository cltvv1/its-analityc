import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminSessionManager,
  bearerToken,
} from "../scripts/admin-auth.mjs";

test("admin password creates an expiring session", () => {
  const sessions = new AdminSessionManager("correct horse", {
    sessionTtlMs: 1_000,
  });
  const login = sessions.authenticate("correct horse", 10_000);

  assert.equal(login.status, "ok");
  assert.ok(login.token);
  assert.deepEqual(sessions.validate(login.token, 10_999), {
    expiresAt: 11_000,
  });
  assert.equal(sessions.validate(login.token, 11_000), null);
});

test("admin session can be revoked", () => {
  const sessions = new AdminSessionManager("secret");
  const login = sessions.authenticate("secret", 1);
  assert.equal(login.status, "ok");

  sessions.revoke(login.token);
  assert.equal(sessions.validate(login.token, 2), null);
});

test("admin login locks temporarily after repeated failures", () => {
  const sessions = new AdminSessionManager("secret", {
    maxAttempts: 2,
    lockoutMs: 500,
  });

  assert.equal(sessions.authenticate("wrong", 1).status, "invalid");
  assert.equal(sessions.authenticate("wrong", 2).status, "blocked");
  assert.equal(sessions.authenticate("secret", 400).status, "blocked");
  assert.equal(sessions.authenticate("secret", 502).status, "ok");
});

test("empty admin password leaves editing unavailable", () => {
  const sessions = new AdminSessionManager("");
  assert.equal(sessions.configured, false);
  assert.equal(sessions.authenticate("", 1).status, "unconfigured");
});

test("bearer token parser accepts only bearer authorization", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("bearer token"), "token");
  assert.equal(bearerToken("Basic abc123"), "");
  assert.equal(bearerToken(null), "");
});
