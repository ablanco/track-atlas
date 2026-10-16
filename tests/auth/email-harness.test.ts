import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { startEmailSink } from "../helpers/email-sink";
import { verifyEmailHarness } from "../helpers/email-harness";
test("external browser runs fail before any test when private capture metadata is absent",()=>{
  const env: NodeJS.ProcessEnv={...process.env,TEST_BASE_URL:"https://external.example.test"}; delete env.EMAIL_TEST_METADATA;
  const result=spawnSync("pnpm",["exec","tsx","-e","import './playwright.config.ts'"],{env,encoding:"utf8"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/capture harness/i);
});
test("capture harness compatibility and authorization are verified before browser mutation",async()=>{
  const directory=await mkdtemp("/tmp/opencode/email-harness-");const path=join(directory,"metadata.json");const previous=process.env.EMAIL_TEST_METADATA;
  const sink=await startEmailSink();
  try {
    process.env.EMAIL_TEST_METADATA=path;
    await writeFile(path,JSON.stringify({...sink,mode:"capture",appOrigin:"http://127.0.0.1:3100"}),{mode:0o600});
    await verifyEmailHarness("http://127.0.0.1:3100");
    await assert.rejects(verifyEmailHarness("https://external.example.test"),/Incompatible/);
    await writeFile(path,JSON.stringify({...sink,mode:"brevo",appOrigin:"http://127.0.0.1:3100"}));
    await assert.rejects(verifyEmailHarness("http://127.0.0.1:3100"),/Incompatible/);
  }finally{if(previous===undefined)delete process.env.EMAIL_TEST_METADATA;else process.env.EMAIL_TEST_METADATA=previous;await sink.close();await unlink(path);await rmdir(directory);}
});
