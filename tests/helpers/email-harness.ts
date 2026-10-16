import { readFile } from "node:fs/promises";
export async function verifyEmailHarness(baseURL: string | undefined) {
  if (!process.env.EMAIL_TEST_METADATA || !baseURL) throw Error("Private capture harness required before browser mutations");
  const metadata = JSON.parse(await readFile(process.env.EMAIL_TEST_METADATA,"utf8"));
  const sink = new URL(metadata.url);
  if(metadata.mode!=="capture" || metadata.appOrigin!==new URL(baseURL).origin || sink.protocol!=="http:" || !["127.0.0.1","[::1]"].includes(sink.hostname) || typeof metadata.token!=="string" || metadata.token.length<32) throw Error("Incompatible private capture harness");
  const response=await fetch(sink,{redirect:"error",signal:AbortSignal.timeout(2000),headers:{authorization:`Bearer ${metadata.token}`}});
  if(!response.ok) throw Error("Private capture harness is unavailable");
}
