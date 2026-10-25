import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";

export const ROLE_OPTIONS = [
  "Admin",
  "Traveller",
  "Train Driver",
  "Station Staff",
  "Special",
  "Friend",
  "Bug Tester",
];

const SESSION_COOKIE = "transitalert_session";
const adminUsername = process.env.ADMIN_USERNAME || "admin";
// No built-in default: the old default was published in git history, so a
// deployment without ADMIN_PASSWORD would accept it. Admin password login is
// simply unavailable until ADMIN_PASSWORD is set.
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (!adminPassword) console.warn("[auth] ADMIN_PASSWORD is not set; admin password login is disabled.");
const adminEmail = (
  process.env.ADMIN_EMAIL ||
  (adminUsername.trim().toLowerCase() === "tyler" ? "tylerbnobleday@gmail.com" : `${adminUsername}@transitalert.local`)
).trim();
const SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  process.env.SESSION_SECRET ||
  // Never derive the signing key from known values: anyone could forge sessions.
  // Without a configured secret, sessions simply last until the next restart.
  crypto.randomBytes(32).toString("hex");
const DEFAULT_PREMIUM_PRICE_AUD = 5;
const REGISTRATION_PHASE = (process.env.REGISTRATION_PHASE || "debug-testers").trim().toLowerCase();
const APPROVED_DEBUG_TESTERS = new Set(
  (process.env.APPROVED_DEBUG_TESTERS || process.env.DEBUG_TESTER_APPROVALS || "")
    .split(/[,\n;]/)
    .map((value) => value.trim())
    .filter(Boolean),
);
const FALLBACK_APPROVED_DEBUG_TESTERS = new Set(["Jack Miller", "jackmiller", "jackzilla110", "testdebuger123"]);
const FALLBACK_USERS = [
  {
    id: "ashton",
    username: "ashton",
    email: "ashton@transitalert.local",
    role: "Friend",
    isAdmin: false,
    isPremium: true,
    passwordHash:
      "b8f28eb7a870c27ec655787dab58ec9a:5b8ae8a17939caf3af87b0ebcbc8f974c223e78b4502e887c5eb5ebcc197b70442e0f9e6f6514bb4c2977267c22da384e076dca4756b0527ce8b3396e73b6f79",
  },
];

function createFallbackUserId(username) {
  return `tester-${String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user"}`;
}

function normalizeTesterValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTesterAlias(value) {
  return normalizeTesterValue(value).replace(/[^a-z0-9]+/g, "");
}

function buildTesterCandidateKeys(username, email) {
  const keys = new Set();
  const normalizedUsername = normalizeTesterValue(username);
  const normalizedEmail = normalizeTesterValue(email);

  if (normalizedUsername) {
    keys.add(normalizedUsername);
    keys.add(normalizeTesterAlias(normalizedUsername));
  }

  if (normalizedEmail) {
    keys.add(normalizedEmail);
    keys.add(normalizeTesterAlias(normalizedEmail));

    const [emailUser] = normalizedEmail.split("@");
    if (emailUser) {
      keys.add(emailUser);
      keys.add(normalizeTesterAlias(emailUser));
    }
  }

  return [...keys].filter(Boolean);
}

function approvalEntriesMatch(entries, username, email) {
  const candidateKeys = buildTesterCandidateKeys(username, email);
  if (candidateKeys.length === 0) {
    return false;
  }

  return [...entries].some((entry) => {
    const normalizedEntry = normalizeTesterValue(entry);
    const aliasEntry = normalizeTesterAlias(entry);
    return candidateKeys.includes(normalizedEntry) || candidateKeys.includes(aliasEntry);
  });
}
let cachedDbContext = undefined;
const loggedDbFallbackScopes = new Set();

async function loadDbContext() {
  if (cachedDbContext !== undefined) {
    return cachedDbContext;
  }

  try {
    const [{ db, ensureDatabaseReady, isDatabaseConfigured }, schema] = await Promise.all([
      import("../../src/lib/db/src/index.js"),
      import("../../src/lib/db/src/schema/auth.js"),
    ]);

    if (isDatabaseConfigured) {
      await ensureDatabaseReady();
    }

    cachedDbContext = db
      ? {
          db,
          appUsersTable: schema.appUsersTable,
          userPreferencesTable: schema.userPreferencesTable,
          appConfigTable: schema.appConfigTable,
          markerOverridesTable: schema.markerOverridesTable,
          passwordResetTokensTable: schema.passwordResetTokensTable,
        }
      : null;
  } catch {
    cachedDbContext = null;
  }

  return cachedDbContext;
}
const defaultPreferences = {
  favouriteStops: [],
  favouriteRoutes: [],
  selectedMapFilters: {},
  transportModes: ["train", "tram", "bus", "vline"],
  appPreferences: {
    premiumAccess: false,
    premiumPriceAud: DEFAULT_PREMIUM_PRICE_AUD,
    premiumPaypalLink: "",
    favouriteConsists: [],
  },
  updatedAt: new Date(),
};
const authRateLimitBuckets = new Map();

function pruneExpiredRateLimitBuckets(now = Date.now()) {
  for (const [key, bucket] of authRateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      authRateLimitBuckets.delete(key);
    }
  }
}

function getFallbackAdminUser() {
  return {
    id: adminUsername.toLowerCase(),
    username: adminUsername,
    email: adminEmail,
    role: "Admin",
    isAdmin: true,
  };
}

function sanitizeFallbackUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isAdmin: Boolean(user.isAdmin),
  };
}

export function isApprovedDebugTester(username, email) {
  const normalizedUsername = normalizeTesterValue(username);
  const normalizedEmail = normalizeTesterValue(email);

  if (!normalizedUsername && !normalizedEmail) {
    return false;
  }

  return (
    approvalEntriesMatch(APPROVED_DEBUG_TESTERS, normalizedUsername, normalizedEmail) ||
    approvalEntriesMatch(FALLBACK_APPROVED_DEBUG_TESTERS, normalizedUsername, normalizedEmail) ||
    FALLBACK_USERS.some(
      (user) =>
        user.username.toLowerCase() === normalizedUsername || user.email.toLowerCase() === normalizedEmail,
    )
  );
}

export function getRegistrationPhase() {
  return REGISTRATION_PHASE;
}

export function listApprovedDebugTesters() {
  const entries = new Map();

  for (const value of APPROVED_DEBUG_TESTERS) {
    if (!value) continue;
    entries.set(value, {
      value,
      source: "env",
    });
  }

  for (const value of FALLBACK_APPROVED_DEBUG_TESTERS) {
    if (!value) continue;
    entries.set(value, {
      value,
      source: "built-in",
    });
  }

  for (const user of FALLBACK_USERS) {
    const username = user.username.trim().toLowerCase();
    if (username) {
      entries.set(username, {
        value: username,
        source: "built-in-account",
      });
    }
  }

  return [...entries.values()].sort((left, right) => left.value.localeCompare(right.value));
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getAccountStorageStatus() {
  const configured = isDatabaseConfigured();
  const context = await loadDbContext();
  return {
    databaseConfigured: configured,
    accountStorage: configured && context?.db ? "database" : "fallback",
  };
}

function findFallbackUserByUsernameOrEmail(username, email = "") {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return (
    FALLBACK_USERS.find(
      (user) =>
        user.username.toLowerCase() === normalizedUsername ||
        (normalizedEmail && user.email.toLowerCase() === normalizedEmail),
    ) ?? null
  );
}

function findFallbackUserBySessionIdentity(id, username = "", email = "") {
  const normalizedId = String(id || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return (
    FALLBACK_USERS.find(
      (user) =>
        user.id.toLowerCase() === normalizedId ||
        (normalizedUsername && user.username.toLowerCase() === normalizedUsername) ||
        (normalizedEmail && user.email.toLowerCase() === normalizedEmail),
    ) ?? null
  );
}

function getFallbackPreferencesForUser(userId) {
  const fallbackUser = findFallbackUserBySessionIdentity(userId);
  return {
    ...defaultPreferences,
    userId,
    appPreferences: {
      ...defaultPreferences.appPreferences,
      premiumAccess: Boolean(fallbackUser?.isPremium) || userId?.toLowerCase?.() === adminUsername.toLowerCase(),
    },
  };
}

function logDbFallback(scope, error) {
  if (loggedDbFallbackScopes.has(scope)) {
    return;
  }
  loggedDbFallbackScopes.add(scope);
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[transitalert-auth] ${scope} falling back: ${message}`);
}

function readClientIpAddress(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  return (
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

export function consumeAuthRateLimit(req, scope, options = {}) {
  const limit = options.limit ?? 10;
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const now = Date.now();
  pruneExpiredRateLimitBuckets(now);
  const ip = readClientIpAddress(req);
  const key = `${scope}:${ip}`;
  const existing = authRateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    authRateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, passwordHash) {
  const [salt, existingHash] = String(passwordHash || "").split(":");
  if (!salt || !existingHash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(existingHash, "hex"), Buffer.from(derived, "hex"));
}

function createSignedSession(user) {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isAdmin: Boolean(user.isAdmin),
    iat: Date.now(),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function createDatabaseUserId() {
  return crypto.randomUUID();
}

function readSessionTokenFromHeaders(req) {
  const authorization = req.headers?.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const customHeader = req.headers?.["x-transitalert-session"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    return customHeader.trim();
  }

  return "";
}

function readSignedSession(rawCookie) {
  if (!rawCookie || typeof rawCookie !== "string") return null;
  const [encoded, signature] = rawCookie.split(".");
  if (!encoded || !signature) return null;
  if (sign(encoded) !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.id) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const cookies = {};
  const header = req.headers?.cookie;
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (typeof res.json === "function") {
    res.json(payload);
    return;
  }
  res.send(payload);
}

export function setSessionCookie(res, user, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const token = createSignedSession(user);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Max-Age=${maxAgeSeconds}; Secure`,
  );
}

export function getSignedSessionToken(user) {
  return createSignedSession(user);
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Max-Age=0; Secure`,
  );
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isAdmin: Boolean(user.isAdmin),
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

export async function ensureAdminAccount() {
  try {
    const context = await loadDbContext();
    if (!context) return;
    const { db, appUsersTable, userPreferencesTable } = context;
    if (!db) return;
    const existing = await db.query.appUsersTable.findFirst({
      where: (fields, operators) => operators.eq(fields.username, adminUsername),
    });

    if (!existing && adminPassword) {
      const [created] = await db.insert(appUsersTable).values({
        id: createDatabaseUserId(),
        username: adminUsername,
        email: adminEmail,
        passwordHash: createPasswordHash(adminPassword),
        role: "Admin",
        isAdmin: true,
      }).returning();
      if (created && userPreferencesTable) {
        await db
          .insert(userPreferencesTable)
          .values({
            userId: created.id,
            appPreferences: {
              ...defaultPreferences.appPreferences,
              premiumAccess: true,
            },
          })
          .onConflictDoUpdate({
            target: userPreferencesTable.userId,
            set: {
              appPreferences: {
                ...defaultPreferences.appPreferences,
                premiumAccess: true,
              },
              updatedAt: new Date(),
            },
          });
      }
      return;
    }

    if (
      existing.email !== adminEmail ||
      existing.role !== "Admin" ||
      existing.isAdmin !== true
    ) {
      await db
        .update(appUsersTable)
        .set({
          email: adminEmail,
          role: "Admin",
          isAdmin: true,
          updatedAt: new Date(),
        })
        .where(eq(appUsersTable.id, existing.id));
    }

    if (userPreferencesTable) {
      await db
        .insert(userPreferencesTable)
        .values({
          userId: existing.id,
          appPreferences: {
            ...defaultPreferences.appPreferences,
            premiumAccess: true,
          },
        })
        .onConflictDoUpdate({
          target: userPreferencesTable.userId,
          set: {
            appPreferences: {
              ...(await getUserPreferences(existing.id))?.appPreferences,
              premiumAccess: true,
            },
            updatedAt: new Date(),
          },
        });
    }
  } catch (error) {
    logDbFallback("ensureAdminAccount", error);
  }
}

export async function getSessionUser(req) {
  await ensureAdminAccount();
  const cookies = parseCookies(req);
  const token = readSessionTokenFromHeaders(req) || cookies[SESSION_COOKIE] || "";
  const parsed = readSignedSession(token);
  if (!parsed?.id) return null;

  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }

    const user = await db.query.appUsersTable.findFirst({
      where: (fields, operators) => operators.eq(fields.id, parsed.id),
    });
    if (!user) return null;

    return sanitizeUser(user);
  } catch (error) {
    logDbFallback("getSessionUser", error);
    if (parsed.id === "guest-session" || parsed.role === "Guest") {
      return {
        id: "guest-session",
        username: "Guest",
        email: "guest@transitalert.local",
        role: "Guest",
        isAdmin: false,
      };
    }
    if (
      String(parsed.username || "").toLowerCase() === adminUsername.toLowerCase() ||
      String(parsed.id || "").toLowerCase() === adminUsername.toLowerCase()
    ) {
      return getFallbackAdminUser();
    }
    const fallbackUser = findFallbackUserBySessionIdentity(parsed.id, parsed.username, parsed.email);
    if (fallbackUser) {
      return sanitizeFallbackUser(fallbackUser);
    }
    return null;
  }
}

export async function authenticateUser(username, password) {
  await ensureAdminAccount();
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const user = await db.query.appUsersTable.findFirst({
      where: (fields, operators) => operators.ilike(fields.username, username),
    });
    if (!user) return null;
    return verifyPassword(password, user.passwordHash) ? sanitizeUser(user) : null;
  } catch (error) {
    logDbFallback("authenticateUser", error);
    if (adminPassword && username.trim().toLowerCase() === adminUsername.toLowerCase() && password === adminPassword) {
      return getFallbackAdminUser();
    }
    return null;
  }
}

export async function changeUserPassword(userId, currentPassword, newPassword) {
  const context = await loadDbContext();
  const db = context?.db ?? null;
  const appUsersTable = context?.appUsersTable;
  if (!db || !appUsersTable) {
    throw new Error("Password changes require DATABASE_URL to be configured.");
  }

  const user = await db.query.appUsersTable.findFirst({
    where: (fields, operators) => operators.eq(fields.id, userId),
  });
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    throw new Error("The current password is incorrect.");
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    throw new Error("Choose a new password that is different from the temporary password.");
  }

  const [updatedUser] = await db
    .update(appUsersTable)
    .set({
      passwordHash: createPasswordHash(newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(appUsersTable.id, userId))
    .returning();

  if (!updatedUser) {
    throw new Error("Account not found.");
  }
  return sanitizeUser(updatedUser);
}

export async function registerUser(input) {
  const context = await loadDbContext();
  const db = context?.db ?? null;
  const userPreferencesTable = context?.userPreferencesTable;
  const appUsersTable = context?.appUsersTable;
  if (!db) {
    throw new Error("Account database is not configured yet. Ask an admin to finish database setup.");
  }
  const [user] = await db
    .insert(appUsersTable)
    .values({
      id: createDatabaseUserId(),
      username: input.username,
      email: input.email,
      passwordHash: createPasswordHash(input.password),
      role: input.role,
      isAdmin: false,
    })
    .returning();

  // Role and admin access always start plain (Traveller, non-admin) — an
  // approved debug tester only ever gets premium features unlocked
  // automatically, never elevated role or admin access. Anything beyond
  // premium is still a manual admin-panel grant.
  await db.insert(userPreferencesTable).values({
    userId: user.id,
    ...(input.grantPremium
      ? { appPreferences: { ...defaultPreferences.appPreferences, premiumAccess: true } }
      : {}),
  });

  return sanitizeUser(user);
}

export async function getUserByUsernameOrEmail(username, email) {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const existingByUsername = await db.query.appUsersTable.findFirst({
      where: (fields, operators) => operators.eq(fields.username, username),
    });
    if (existingByUsername) return existingByUsername;

    return db.query.appUsersTable.findFirst({
      where: (fields, operators) => operators.eq(fields.email, email),
    });
  } catch (error) {
    logDbFallback("getUserByUsernameOrEmail", error);
    const matchesAdmin =
      username.trim().toLowerCase() === adminUsername.toLowerCase() ||
      email.trim().toLowerCase() === adminEmail.toLowerCase();
    if (matchesAdmin) {
      return getFallbackAdminUser();
    }
    return null;
  }
}

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Always returns null on a "no such account" case rather than throwing, so
// the calling API route can respond identically either way — never confirm
// or deny whether an email address has an account (standard reset-flow
// practice against email enumeration).
export async function createPasswordResetToken(email) {
  const context = await loadDbContext();
  const db = context?.db ?? null;
  const passwordResetTokensTable = context?.passwordResetTokensTable;
  if (!db || !passwordResetTokensTable) return null;

  const user = await db.query.appUsersTable.findFirst({
    where: (fields, operators) => operators.eq(fields.email, String(email || "").trim().toLowerCase()),
  });
  if (!user) return null;

  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(passwordResetTokensTable).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
  });
  return { token, user: sanitizeUser(user) };
}

export async function resetPasswordWithToken(token, newPassword) {
  const context = await loadDbContext();
  const db = context?.db ?? null;
  const appUsersTable = context?.appUsersTable;
  const passwordResetTokensTable = context?.passwordResetTokensTable;
  if (!db || !appUsersTable || !passwordResetTokensTable) {
    throw new Error("Password resets require DATABASE_URL to be configured.");
  }

  const tokenRow = await db.query.passwordResetTokensTable.findFirst({
    where: (fields, operators) =>
      operators.and(operators.eq(fields.token, token), operators.isNull(fields.usedAt), operators.gt(fields.expiresAt, new Date())),
  });
  if (!tokenRow) {
    throw new Error("This reset link is invalid or has expired. Request a new one.");
  }

  const [updatedUser] = await db
    .update(appUsersTable)
    .set({ passwordHash: createPasswordHash(newPassword), mustChangePassword: false, updatedAt: new Date() })
    .where(eq(appUsersTable.id, tokenRow.userId))
    .returning();
  if (!updatedUser) {
    throw new Error("Account not found.");
  }

  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.token, token));

  return sanitizeUser(updatedUser);
}

export async function listAccounts() {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }

    const accounts = await db.query.appUsersTable.findMany();
    const decorated = await Promise.all(
      accounts.map(async (account) => {
        const preferences = await getUserPreferences(account.id);
        return {
          ...sanitizeUser(account),
          isPremium: Boolean(preferences?.appPreferences?.premiumAccess),
          createdAt: account.createdAt?.toISOString?.() ?? undefined,
          updatedAt: account.updatedAt?.toISOString?.() ?? undefined,
        };
      }),
    );

    return decorated.sort((left, right) => left.username.localeCompare(right.username));
  } catch (error) {
    logDbFallback("listAccounts", error);
    return [getFallbackAdminUser(), ...FALLBACK_USERS.map((user) => sanitizeFallbackUser(user))].map((user) => ({
      ...user,
      isPremium:
        user.username.toLowerCase() === adminUsername.toLowerCase() ||
        FALLBACK_USERS.some((fallback) => fallback.id === user.id && fallback.isPremium),
    }));
  }
}

export async function updateAccountAccess(accountId, patch) {
  const context = await loadDbContext();
  const db = context?.db ?? null;
  const appUsersTable = context?.appUsersTable;
  if (!db || !appUsersTable) {
    throw new Error("Account updates require DATABASE_URL to be configured.");
  }

  const [updatedUser] = await db
    .update(appUsersTable)
    .set({
      role: patch.role,
      isAdmin: Boolean(patch.isAdmin),
      updatedAt: new Date(),
    })
    .where(eq(appUsersTable.id, accountId))
    .returning();

  if (!updatedUser) {
    throw new Error("Account not found.");
  }

  const existingPreferences = await getUserPreferences(accountId);
  const nextPreferences = await upsertUserPreferences(accountId, {
    appPreferences: {
      ...(existingPreferences?.appPreferences ?? {}),
      premiumAccess: Boolean(patch.isPremium),
    },
  });

  return {
    ...sanitizeUser(updatedUser),
    isPremium: Boolean(nextPreferences?.appPreferences?.premiumAccess),
    createdAt: updatedUser.createdAt?.toISOString?.() ?? undefined,
    updatedAt: updatedUser.updatedAt?.toISOString?.() ?? undefined,
  };
}

export async function getUserPreferences(userId) {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const { userPreferencesTable } = context;
    const existing = await db.query.userPreferencesTable.findFirst({
      where: (fields, operators) => operators.eq(fields.userId, userId),
    });

    if (existing) return existing;

    const [created] = await db.insert(userPreferencesTable).values({ userId }).returning();
    return created;
  } catch (error) {
    logDbFallback("getUserPreferences", error);
    return getFallbackPreferencesForUser(userId);
  }
}

export async function upsertUserPreferences(userId, patch) {
  // Push filters have their own atomic, authenticated save route. A stale
  // Home/favourites snapshot must not undo a notification opt-out.
  if (patch.appPreferences && typeof patch.appPreferences === "object") {
    const { pushNotificationCategories, pushNotificationLines, ...appPreferences } = patch.appPreferences;
    patch = { ...patch, appPreferences };
  }
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const { userPreferencesTable } = context;
    const existing = await getUserPreferences(userId);
    const [updated] = await db
      .insert(userPreferencesTable)
      .values({
        userId,
        favouriteStops: patch.favouriteStops ?? existing.favouriteStops,
        favouriteRoutes: patch.favouriteRoutes ?? existing.favouriteRoutes,
        selectedMapFilters: patch.selectedMapFilters ?? existing.selectedMapFilters,
        transportModes: patch.transportModes ?? existing.transportModes,
        appPreferences: patch.appPreferences ?? existing.appPreferences,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferencesTable.userId,
        set: {
          favouriteStops: patch.favouriteStops ?? existing.favouriteStops,
          favouriteRoutes: patch.favouriteRoutes ?? existing.favouriteRoutes,
          selectedMapFilters: patch.selectedMapFilters ?? existing.selectedMapFilters,
          transportModes: patch.transportModes ?? existing.transportModes,
          appPreferences: patch.appPreferences
            ? sql`${userPreferencesTable.appPreferences} || ${JSON.stringify(patch.appPreferences)}::jsonb`
            : userPreferencesTable.appPreferences,
          updatedAt: new Date(),
        },
      })
      .returning();

    return updated;
  } catch (error) {
    logDbFallback("upsertUserPreferences", error);
    const fallbackPreferences = getFallbackPreferencesForUser(userId);
    return {
      userId,
      favouriteStops: patch.favouriteStops ?? fallbackPreferences.favouriteStops,
      favouriteRoutes: patch.favouriteRoutes ?? fallbackPreferences.favouriteRoutes,
      selectedMapFilters: patch.selectedMapFilters ?? fallbackPreferences.selectedMapFilters,
      transportModes: patch.transportModes ?? fallbackPreferences.transportModes,
      appPreferences: {
        ...fallbackPreferences.appPreferences,
        ...(patch.appPreferences ?? {}),
      },
      updatedAt: new Date(),
    };
  }
}

export async function getAppConfig() {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) return {};
    const { appConfigTable } = context;
    const rows = await db.select().from(appConfigTable);
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } catch (error) {
    logDbFallback("getAppConfig", error);
    return {};
  }
}

export async function setAppConfigValue(key, value, updatedBy) {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const { appConfigTable } = context;
    const [row] = await db
      .insert(appConfigTable)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appConfigTable.key,
        set: { value, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return row;
  } catch (error) {
    logDbFallback("setAppConfigValue", error);
    return { key, value, updatedBy, updatedAt: new Date() };
  }
}

export async function listMarkerOverrides() {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) return [];
    const { markerOverridesTable } = context;
    return db.select().from(markerOverridesTable);
  } catch (error) {
    logDbFallback("listMarkerOverrides", error);
    return [];
  }
}

export async function saveMarkerOverrides(overrides, updatedBy) {
  try {
    const context = await loadDbContext();
    const db = context?.db ?? null;
    if (!db) {
      throw new Error("Database unavailable");
    }
    const { markerOverridesTable } = context;
    const saved = [];
    for (const override of overrides) {
      const [row] = await db
        .insert(markerOverridesTable)
        .values({
          markerName: override.markerName,
          markerType: override.markerType ?? "station",
          lat: override.lat,
          lng: override.lng,
          metadata: override.metadata ?? {},
          updatedBy,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: markerOverridesTable.markerName,
          set: {
            lat: override.lat,
            lng: override.lng,
            markerType: override.markerType ?? "station",
            metadata: override.metadata ?? {},
            updatedBy,
            updatedAt: new Date(),
          },
        })
        .returning();
      saved.push(row);
    }
    return saved;
  } catch (error) {
    logDbFallback("saveMarkerOverrides", error);
    return overrides.map((override, index) => ({
      id: index + 1,
      markerName: override.markerName,
      markerType: override.markerType ?? "station",
      lat: override.lat,
      lng: override.lng,
      metadata: override.metadata ?? {},
      updatedBy,
      updatedAt: new Date(),
    }));
  }
}
