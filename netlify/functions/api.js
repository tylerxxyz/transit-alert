import adminHandler from "../../api/admin/[resource].js";
import authHandler from "../../api/auth/[action].js";
import consistHandler from "../../api/consist/[consist].js";
import metroNotifyAlertsHandler from "../../api/metro-notify/alerts.js";
import preferencesHandler from "../../api/preferences/[[...slug]].js";
import liveBusesHandler from "../../api/ptv/live-buses.js";
import liveTrainsHandler from "../../api/ptv/live-trains.js";
import liveTramsHandler from "../../api/ptv/live-trams.js";
import networkHandler from "../../api/transit/network.js";
import reportsHandler from "../../api/reports/[[...slug]].js";
import telegramStatusHandler from "../../api/telegram/status.js";

function decodeEventBody(event) {
  if (!event.body) return undefined;

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "");
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function createRequestShim(event, query) {
  return {
    method: event.httpMethod,
    headers: event.headers || {},
    body: decodeEventBody(event),
    query,
    url: event.rawUrl || event.path,
  };
}

function createResponseShim() {
  const response = {
    statusCode: 200,
    headers: {},
    multiValueHeaders: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      if (Array.isArray(value)) {
        this.multiValueHeaders[name] = value.map(String);
      } else {
        this.headers[name] = String(value);
      }
      return this;
    },
    json(payload) {
      if (!this.headers["Content-Type"] && !this.headers["content-type"]) {
        this.headers["Content-Type"] = "application/json; charset=utf-8";
      }
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      if (typeof payload === "string") {
        this.body = payload;
        return this;
      }

      if (Buffer.isBuffer(payload)) {
        this.body = payload.toString("utf8");
        return this;
      }

      if (!this.headers["Content-Type"] && !this.headers["content-type"]) {
        this.headers["Content-Type"] = "application/json; charset=utf-8";
      }
      this.body = JSON.stringify(payload);
      return this;
    },
  };

  return response;
}

function getPathSegments(event) {
  const cleaned = String(event.path || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return cleaned ? cleaned.split("/").map(decodeURIComponent) : [];
}

function getQuery(event) {
  return { ...(event.queryStringParameters || {}) };
}

function resolveHandler(event) {
  const segments = getPathSegments(event);
  if (segments[0] !== "api") {
    return null;
  }

  const query = getQuery(event);
  const group = segments[1] || "";
  const remainder = segments.slice(2);

  switch (group) {
    case "transit":
      return remainder[0] === "network" ? { handler: networkHandler, query } : null;
    case "auth":
      return { handler: authHandler, query: { ...query, action: remainder[0] || "" } };
    case "preferences":
      return { handler: preferencesHandler, query: { ...query, slug: remainder } };
    case "reports":
      return { handler: reportsHandler, query: { ...query, slug: remainder } };
    case "admin":
      return { handler: adminHandler, query: { ...query, resource: remainder[0] || "" } };
    case "consist":
      return { handler: consistHandler, query: { ...query, consist: remainder[0] || "" } };
    case "metro-notify":
      if (remainder[0] === "alerts") {
        return { handler: metroNotifyAlertsHandler, query };
      }
      return null;
    case "ptv":
      if (remainder[0] === "live-buses") {
        return { handler: liveBusesHandler, query };
      }
      if (remainder[0] === "live-trains") {
        return { handler: liveTrainsHandler, query };
      }
      if (remainder[0] === "live-trams") {
        return { handler: liveTramsHandler, query };
      }
      return null;
    case "telegram":
      if (remainder[0] === "status") {
        return { handler: telegramStatusHandler, query };
      }
      return null;
    default:
      return null;
  }
}

export async function handler(event) {
  const resolved = resolveHandler(event);
  if (!resolved) {
    return {
      statusCode: 404,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ error: "Unknown API route" }),
    };
  }

  const req = createRequestShim(event, resolved.query);
  const res = createResponseShim();

  await resolved.handler(req, res);

  return {
    statusCode: res.statusCode,
    headers: res.headers,
    multiValueHeaders:
      Object.keys(res.multiValueHeaders).length > 0 ? res.multiValueHeaders : undefined,
    body: res.body,
  };
}
