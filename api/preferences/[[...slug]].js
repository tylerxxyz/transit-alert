import {
  getSessionUser,
  getUserPreferences,
  readJsonBody,
  sendJson,
  upsertUserPreferences,
} from "../_lib/auth.js";

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user || user.role === "Guest") {
    sendJson(res, 401, { error: "Sign in to access account preferences" });
    return;
  }

  const slug = Array.isArray(req.query?.slug) ? req.query.slug : req.query?.slug ? [req.query.slug] : [];
  const action = slug[0] || "";

  if (!action) {
    if (req.method === "GET") {
      const preferences = await getUserPreferences(user.id);
      sendJson(res, 200, { preferences });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await readJsonBody(req);
      // premiumAccess is an admin-granted flag (see /api/admin/accounts), never
      // something a non-admin's own settings save should be able to change. A
      // client's local preferences state can go stale (e.g. loaded before an
      // admin granted premium), and this endpoint used to trust whatever
      // appPreferences object the client sent wholesale — silently reverting
      // a real grant the moment the user next saved any unrelated setting.
      // Non-admins always keep the server's existing value here regardless of
      // what the client submitted; admins retain the Settings self-toggle for
      // their own account (see the "Enable/Disable" premium button).
      if (!user.isAdmin && body && typeof body === "object" && body.appPreferences && typeof body.appPreferences === "object") {
        const existing = await getUserPreferences(user.id);
        body.appPreferences = {
          ...body.appPreferences,
          premiumAccess: existing?.appPreferences?.premiumAccess === true,
        };
      }
      const preferences = await upsertUserPreferences(user.id, body);
      sendJson(res, 200, { preferences });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (action === "merge") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const body = await readJsonBody(req);
    const existing = await getUserPreferences(user.id);
    const merged = await upsertUserPreferences(user.id, {
      favouriteStops: uniq([...(existing.favouriteStops ?? []), ...asArray(body?.favouriteStops)]),
      favouriteRoutes: uniq([...(existing.favouriteRoutes ?? []), ...asArray(body?.favouriteRoutes)]),
      transportModes: uniq([...(existing.transportModes ?? []), ...asArray(body?.transportModes)]),
      selectedMapFilters: {
        ...(existing.selectedMapFilters ?? {}),
        ...asObject(body?.selectedMapFilters),
      },
      // Same admin-only-grant protection as the plain save handler above:
      // never let a non-admin's client-submitted merge move premiumAccess.
      appPreferences: {
        ...(existing.appPreferences ?? {}),
        ...asObject(body?.appPreferences),
        ...(user.isAdmin ? {} : { premiumAccess: existing?.appPreferences?.premiumAccess === true }),
      },
    });

    sendJson(res, 200, { preferences: merged });
    return;
  }

  sendJson(res, 404, { error: "Unknown preferences action" });
}
