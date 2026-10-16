import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../../db/client";
import { reserveEmailDailyBudget, reserveEmailRequest } from "../../auth/email-rate-limit";
loadEnvConfig(process.cwd(),true);
const control=createDatabase(process.env.DATABASE_URL);
after(()=>control.pool.end());
async function isolatedClock(work:(instance:ReturnType<typeof createDatabase>,set:(time:string)=>Promise<void>,schema:string,app:string)=>Promise<void>) {
  const suffix=randomUUID().replaceAll("-","");const schema=`email_clock_${suffix}`,app=`email-clock-${suffix}`;
  await control.pool.query(`CREATE SCHEMA ${schema}`);
  let instance:ReturnType<typeof createDatabase>|undefined;
  try {
    await control.pool.query(`CREATE TABLE ${schema}.email_send_limits (LIKE public.email_send_limits INCLUDING ALL)`);
    await control.pool.query(`CREATE TABLE ${schema}.test_clock (value timestamptz NOT NULL)`);
    await control.pool.query(`INSERT INTO ${schema}.test_clock VALUES ('2026-01-01T23:59:59Z')`);
    // Test-only DB clock, never compiled into an application module or migration.
    await control.pool.query(`CREATE FUNCTION ${schema}.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE AS 'SELECT value FROM ${schema}.test_clock'`);
    const url=new URL(process.env.DATABASE_URL!);url.searchParams.set("options",`-csearch_path=${schema},pg_catalog,public`);url.searchParams.set("application_name",app);
    instance=createDatabase(url.href);
    const set=async(time:string)=>{await control.pool.query(`UPDATE ${schema}.test_clock SET value=$1`,[time]);};
    await work(instance,set,schema,app);
  } finally {await instance?.pool.end();await control.pool.query(`DROP SCHEMA ${schema} CASCADE`);}
}
async function waitForLock(app:string) {
  for(let i=0;i<200;i++) {
    const result=await control.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'",[app]);
    if(result.rowCount)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error("Expected real database lock wait");
}
test("concurrent daily attempts cap at 250 and a midnight crossed during lock wait uses the new UTC day",async()=>{
  await isolatedClock(async(instance,set,_schema,app)=>{
    const results=await Promise.all(Array.from({length:260},()=>reserveEmailDailyBudget(instance.db)));
    assert.equal(results.filter(Boolean).length,250);
    const blocker=await control.pool.connect();
    try {
      await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(247192613)");
      const pending=reserveEmailDailyBudget(instance.db);await waitForLock(app);
      await set("2026-01-02T00:00:00Z");await blocker.query("COMMIT");
      assert.equal(await pending,true);
      const counts=await instance.pool.query("SELECT key,cardinality(attempted_at) AS count FROM email_send_limits ORDER BY key");
      assert.deepEqual(counts.rows,[{key:"daily:2026-01-01",count:250},{key:"daily:2026-01-02",count:1}]);
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
});
for(const boundary of ["cooldown","hour"] as const) test(`${boundary} crossed while waiting for an address lock is evaluated after acquiring it`,async()=>{
  await isolatedClock(async(instance,set,schema,app)=>{
    await set("2026-01-02T00:00:00Z");
    assert.equal((await reserveEmailRequest(instance.db,"password-reset","owned-test-key")).allowed,true);
    if(boundary==="hour") await instance.pool.query("UPDATE email_send_limits SET attempted_at=ARRAY['2026-01-02T00:00:00Z'::timestamptz,'2026-01-02T00:01:00Z'::timestamptz,'2026-01-02T00:02:00Z'::timestamptz]");
    const blocker=await control.pool.connect();
    try {
      await blocker.query("BEGIN");await blocker.query(`SELECT key FROM ${schema}.email_send_limits FOR UPDATE`);
      const pending=reserveEmailRequest(instance.db,"password-reset","owned-test-key");await waitForLock(app);
      await set(boundary==="hour"?"2026-01-02T01:02:00Z":"2026-01-02T00:01:00Z");await blocker.query("COMMIT");
      assert.deepEqual(await pending,{allowed:true});
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
});
