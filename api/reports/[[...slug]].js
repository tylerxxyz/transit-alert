import { createReportRepository } from "../_lib/report-repository.js";

const melbourneDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
});

export function buildReportStats(reports, now = new Date()) {
  const today = melbourneDay.format(now);
  const current = reports.filter((report) => {
    const date = new Date(report.createdAt);
    return Number.isFinite(date.getTime()) && date <= now && melbourneDay.format(date) === today;
  });
  const routes = new Map();
  for (const report of current) {
    if (report.reportType !== "inspector") continue;
    const lineNumber = report.lineNumber?.trim();
    if (!lineNumber) continue;
    const key = `${report.transportType}:${lineNumber}`;
    const route = routes.get(key) || { lineNumber, transportType: report.transportType, reportCount: 0 };
    route.reportCount++;
    routes.set(key, route);
  }
  return {
    alertsToday: current.length,
    riskyRoutes: [...routes.values()]
      .map((route) => ({
        ...route,
        riskLevel: route.reportCount >= 5 ? "high" : route.reportCount >= 3 ? "medium" : "low",
      }))
      .sort((a, b) => b.reportCount - a.reportCount)
      .slice(0, 8),
  };
}

export function validateReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Report must be an object";
  if (!["inspector", "delay", "incident"].includes(body.reportType)) return "Invalid report type";
  if (!["tram", "train", "bus", "stop"].includes(body.transportType)) return "Invalid transport type";
  if (body.direction != null && !["city_bound", "outbound", "unknown"].includes(body.direction)) return "Invalid direction";
  for (const [key, limit] of [["locationName", 200], ["username", 100]]) {
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > limit) return `Invalid ${key}`;
  }
  for (const [key, limit] of [["lineNumber", 100], ["notes", 4000]]) {
    if (body[key] != null && (typeof body[key] !== "string" || body[key].length > limit)) return `Invalid ${key}`;
  }
  if ((body.lat == null) !== (body.lng == null)) return "Latitude and longitude must be provided together";
  for (const [key, limit] of [["lat", 90], ["lng", 180]]) {
    if (body[key] != null && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || Math.abs(body[key]) > limit)) return `Invalid ${key}`;
  }
  return null;
}

export function createReportsHandler(repository) {
  return async function handler(req, res) {
    const slug = Array.isArray(req.query?.slug) ? req.query.slug : req.query?.slug ? [req.query.slug] : [];
    const action = slug[0] || "";
    if (slug.length > 1 || (action && action !== "stats")) return res.status(404).json({ error: "Unknown reports action" });
    if ((action && req.method !== "GET") || (!action && !["GET", "POST"].includes(req.method))) {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (req.method === "POST") {
      const error = validateReport(req.body);
      if (error) return res.status(400).json({ error });
    }
    try {
      if (req.method === "GET") {
        const reports = await repository.list();
        return res.status(200).json(action === "stats" ? buildReportStats(reports) : reports);
      }
      const body = req.body;
      const report = await repository.insert({
        reportType: body.reportType,
        transportType: body.transportType,
        direction: body.direction ?? "unknown",
        locationName: body.locationName.trim(),
        username: body.username.trim(),
        lineNumber: body.lineNumber?.trim() || null,
        notes: body.notes?.trim() || null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
      });
      return res.status(201).json(report);
    } catch {
      return res.status(503).json({ error: "Reports are temporarily unavailable. Please try again later." });
    }
  };
}

export default createReportsHandler(createReportRepository());
