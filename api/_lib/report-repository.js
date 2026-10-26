const projection = `id, report_type AS "reportType", transport_type AS "transportType", line_number AS "lineNumber", direction, location_name AS "locationName", notes, username, lat, lng, created_at AS "createdAt"`;
// Never acknowledge a report stored only in process memory.
export function createReportRepository(queryOverride) {
  let ready;
  async function query(text,params=[]) {
    if(queryOverride) return queryOverride(text,params);
    const {pool,pglite}=await import('../../src/lib/db/src/index.js');
    const client=pglite||pool;
    if(!client) throw new Error('Reports require a configured database');
    return client.query(text,params);
  }
  async function ensureReady() {
    if(!ready) ready=query(`CREATE TABLE IF NOT EXISTS reports (
      id serial PRIMARY KEY, report_type text NOT NULL DEFAULT 'inspector', transport_type text NOT NULL,
      line_number text, direction text DEFAULT 'unknown', location_name text NOT NULL, notes text,
      username text NOT NULL, lat double precision, lng double precision, created_at timestamp NOT NULL DEFAULT now()
    )`).catch(error=>{ready=null;throw error;});
    await ready;
  }
  return {
    async list() { await ensureReady(); return (await query(`SELECT ${projection} FROM reports WHERE created_at > now() - interval '30 days' ORDER BY created_at DESC, id DESC LIMIT 2000`)).rows; },
    async insert(r) {
      await ensureReady();
      return (await query(`INSERT INTO reports (report_type,transport_type,line_number,direction,location_name,notes,username,lat,lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${projection}`,[r.reportType,r.transportType,r.lineNumber,r.direction,r.locationName,r.notes,r.username,r.lat,r.lng])).rows[0];
    }
  };
}
