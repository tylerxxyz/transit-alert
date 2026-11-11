import {
  consumeAuthRateLimit,
  createPasswordResetToken,
  getAccountStorageStatus,
  getRegistrationPhase,
  isDatabaseConfigured,
  ROLE_OPTIONS,
  authenticateUser,
  changeUserPassword,
  clearSessionCookie,
  getSessionUser,
  getUserByUsernameOrEmail,
  isApprovedDebugTester,
  readJsonBody,
  registerUser,
  resetPasswordWithToken,
  sendJson,
  setSessionCookie,
  getSignedSessionToken,
} from "../_lib/auth.js";
import { applyCorsHeaders, isCrossSiteWriteBlocked, getPublicAppUrl } from "../_lib/cors.js";
import { sendPasswordResetEmail, sendWelcomeEmail } from "../_lib/mailer.js";

function isStrongEnoughPassword(password) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export default async function handler(req, res) {
  const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
  applyCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (isCrossSiteWriteBlocked(req)) {
    sendJson(res, 403, { error: "Cross-site request blocked" });
    return;
  }

  const rejectIfRateLimited = (scope, options) => {
    const result = consumeAuthRateLimit(req, scope, options);
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      sendJson(res, 429, { error: "Too many attempts. Please wait a moment and try again." });
      return true;
    }
    return false;
  };

  if (action === "session") {
    const user = await getSessionUser(req);
    const storageStatus = await getAccountStorageStatus();
    sendJson(res, 200, {
      authenticated: Boolean(user),
      user: user ?? null,
      roles: ROLE_OPTIONS,
      databaseConfigured: storageStatus.databaseConfigured,
      accountStorage: storageStatus.accountStorage,
      sessionToken: user ? getSignedSessionToken(user) : null,
    });
    return;
  }

  if (action === "roles") {
    sendJson(res, 200, {
      roles: ROLE_OPTIONS,
      publicRoles: ["Traveller"],
      registrationPhase: getRegistrationPhase(),
      databaseConfigured: isDatabaseConfigured(),
    });
    return;
  }

  if (action === "guest") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("guest-session", { limit: 15, windowMs: 10 * 60 * 1000 })) {
      return;
    }

    const guestUser = {
      id: "guest-session",
      username: "Guest",
      email: "guest@transitalert.local",
      role: "Guest",
      isAdmin: false,
    };

    setSessionCookie(res, guestUser, 60 * 60 * 24 * 2);
    sendJson(res, 200, {
      authenticated: true,
      user: guestUser,
      roles: ROLE_OPTIONS,
      sessionToken: getSignedSessionToken(guestUser),
    });
    return;
  }

  if (action === "logout") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    clearSessionCookie(res);
    sendJson(res, 200, { success: true });
    return;
  }

  if (action === "login") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("login", { limit: 12, windowMs: 10 * 60 * 1000 })) {
      return;
    }

    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username) {
      sendJson(res, 400, { error: "Username is required" });
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      sendJson(res, 400, { error: "Username format is invalid" });
      return;
    }
    if (!isDatabaseConfigured() && username.trim().toLowerCase() !== String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase()) {
      sendJson(res, 503, {
        error: "Account database is not configured yet. Ask an admin to finish database setup before signing in.",
      });
      return;
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      sendJson(res, 401, { error: "Invalid username or password" });
      return;
    }

    setSessionCookie(res, user);
    sendJson(res, 200, {
      authenticated: true,
      user,
      roles: ROLE_OPTIONS,
      sessionToken: getSignedSessionToken(user),
    });
    return;
  }

  if (action === "change-password") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("change-password", { limit: 8, windowMs: 15 * 60 * 1000 })) {
      return;
    }

    const user = await getSessionUser(req);
    if (!user || user.role === "Guest") {
      sendJson(res, 401, { error: "Sign in before changing your password." });
      return;
    }

    const body = await readJsonBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 10) {
      sendJson(res, 400, { error: "New password must be at least 10 characters." });
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      sendJson(res, 400, { error: "New password must include at least one letter and one number." });
      return;
    }

    try {
      const updatedUser = await changeUserPassword(user.id, currentPassword, newPassword);
      setSessionCookie(res, updatedUser);
      sendJson(res, 200, {
        authenticated: true,
        user: updatedUser,
        roles: ROLE_OPTIONS,
        sessionToken: getSignedSessionToken(updatedUser),
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : "Password change failed.",
      });
    }
    return;
  }

  if (action === "register") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("register", { limit: 6, windowMs: 30 * 60 * 1000 })) {
      return;
    }

    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const normalized = username.toLowerCase();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const requestedRole = String(body.role || "Traveller").trim();
    const registrationPhase = getRegistrationPhase();
    if (!isDatabaseConfigured()) {
      sendJson(res, 503, {
        error: "Registration is disabled until the account database is configured.",
      });
      return;
    }

    if (!username || username.length < 3) {
      sendJson(res, 400, { error: "Username must be at least 3 characters" });
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      sendJson(res, 400, { error: "Username must use only letters, numbers, dots, dashes, or underscores" });
      return;
    }

    if (!password || password.length < 6) {
      sendJson(res, 400, { error: "Password must be at least 6 characters" });
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 400, { error: "A valid email address is required" });
      return;
    }

    if (!ROLE_OPTIONS.includes(requestedRole)) {
      sendJson(res, 400, { error: "Please choose a valid role" });
      return;
    }

    const approvedTester = isApprovedDebugTester(username, email);
    if (registrationPhase !== "public" && !approvedTester) {
      sendJson(res, 403, {
        error:
          "Registration is currently limited to approved debug testers. Public Traveller sign-ups open in version 1.0 after Tyler approves access.",
      });
      return;
    }

    if (!approvedTester && requestedRole !== "Traveller") {
      sendJson(res, 403, {
        error: "New public accounts can only start as Traveller. Staff, tester, and premium roles are approved manually.",
      });
      return;
    }

    const existing = await getUserByUsernameOrEmail(username, email);
    if (existing) {
      sendJson(res, 409, {
        error:
          existing.username.toLowerCase() === normalized
            ? "That username is already taken"
            : "That email address is already registered",
      });
      return;
    }

    let user;
    // Every newly created account starts as a plain Traveller with no admin
    // access, regardless of the debug-tester allowlist or requested role —
    // staff, tester, and admin access are granted manually afterward via the
    // admin panel, never automatically at sign-up.
    const finalRole = "Traveller";
    try {
      user = await registerUser({ username, email, password, role: finalRole, grantPremium: approvedTester });
    } catch (error) {
      sendJson(res, 503, {
        error: error instanceof Error ? error.message : "Registration is unavailable right now",
      });
      return;
    }
    setSessionCookie(res, user);
    sendJson(res, 201, {
      authenticated: true,
      user,
      roles: ROLE_OPTIONS,
      sessionToken: getSignedSessionToken(user),
    });
    // Fire-and-forget — a slow or failed welcome email must never hold up or
    // fail account creation itself.
    sendWelcomeEmail(user).catch(() => {});
    return;
  }

  if (action === "request-password-reset") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("request-password-reset", { limit: 6, windowMs: 15 * 60 * 1000 })) {
      return;
    }

    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    // Always respond the same way whether or not the email is registered —
    // confirming/denying an account's existence here is an email-enumeration
    // leak, so the UI can only ever say "if that address has an account...".
    const genericResponse = { message: "If that email address has a TransitAlert account, a reset link is on its way." };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(res, 200, genericResponse);
      return;
    }

    const result = await createPasswordResetToken(email).catch(() => null);
    if (result) {
      // Built from configuration, never the request's Origin header: an
      // attacker-supplied Origin turned genuine reset emails into links that
      // sent the token to the attacker's site.
      const resetUrl = `${getPublicAppUrl()}/reset-password?token=${encodeURIComponent(result.token)}`;
      sendPasswordResetEmail(result.user, resetUrl).catch(() => {});
    }
    sendJson(res, 200, genericResponse);
    return;
  }

  if (action === "reset-password") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    if (rejectIfRateLimited("reset-password", { limit: 10, windowMs: 15 * 60 * 1000 })) {
      return;
    }

    const body = await readJsonBody(req);
    const token = String(body.token || "").trim();
    const newPassword = String(body.newPassword || "");
    if (!token) {
      sendJson(res, 400, { error: "Reset token is required." });
      return;
    }
    if (!isStrongEnoughPassword(newPassword)) {
      sendJson(res, 400, { error: "New password must be at least 10 characters and include a letter and a number." });
      return;
    }

    try {
      const user = await resetPasswordWithToken(token, newPassword);
      setSessionCookie(res, user);
      sendJson(res, 200, {
        authenticated: true,
        user,
        roles: ROLE_OPTIONS,
        sessionToken: getSignedSessionToken(user),
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Password reset failed." });
    }
    return;
  }

  sendJson(res, 404, { error: "Unknown auth action" });
}
