import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildReportStats, validateReport, createReportsHandler } from '../reports/[[...slug]].js';
import { createReportRepository } from './report-repository.js';
const valid={reportType:'delay',transportType:'train',locationName:' Richmond ',username:' Tester ',lineNumber:' Belgrave ',notes:'Late'};
test('reject malformed reports instead of silently inventing inspector/train sightings',()=>{
  for(const b of [null,[],{}, {...valid,reportType:'typo'}, {...valid,transportType:'boat'}, {...valid,locationName:'  '}, {...valid,lat:NaN,lng:144}, {...valid,lat:-91,lng:144}, {...valid,lat:-37,lng:181}, {...valid,lat:-37}, {...valid,notes:7}]) assert.ok(validateReport(b));
  assert.equal(validateReport(valid),null);
  assert.equal(validateReport({...valid,lat:-37,lng:144}),null);
});
test('today stats use Melbourne midnight including daylight saving and exclude future/corrupt dates',()=>{
  const now=new Date('2026-10-25T00:00:00Z');
  const rows=['2026-10-24T12:59:59Z','2026-10-24T13:00:00Z','2026-10-25T00:00:01Z','bad'].map(createdAt=>({...valid,reportType:'inspector',createdAt}));
  assert.equal(buildReportStats(rows,now).alertsToday,1);
  assert.equal(buildReportStats(rows,now).riskyRoutes[0].reportCount,1);
  const mixed=[...rows,{...valid,createdAt:'2026-10-24T13:00:00Z'}];
  assert.equal(buildReportStats(mixed,now).alertsToday,2);
  assert.equal(buildReportStats(mixed,now).riskyRoutes[0].reportCount,1);
});
test('reports survive repository recreation in the shared SQL database',async()=>{
  const database=new PGlite();
  try {
    const query=(sql,params)=>database.query(sql,params);
    const r=await createReportRepository(query).insert({...valid,direction:'unknown',lat:null,lng:null});
    assert.equal(r.id,1);
    const rows=await createReportRepository(query).list();
    assert.equal(rows.length,1); assert.equal(rows[0].reportType,'delay'); assert.equal(rows[0].notes,'Late');
  } finally {await database.close();}
});
test('HTTP failure does not acknowledge a report when durable storage is unavailable',async()=>{
  const handler=createReportsHandler({insert:async()=>{throw new Error('offline');}});
  const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',query:{},body:valid},res);
  assert.equal(res.code,503); assert.ok(res.body.error);
});
test('invalid submission cannot reach storage; valid fields are normalized',async()=>{
  let inserted;
  const handler=createReportsHandler({insert:async r=>{inserted=r;return {id:1,...r};}});
  const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',query:{},body:{}},res); assert.equal(res.code,400);assert.equal(inserted,undefined);
  await handler({method:'POST',query:{},body:valid},res);assert.equal(res.code,201);assert.equal(inserted.locationName,'Richmond');assert.equal(inserted.direction,'unknown');
});
