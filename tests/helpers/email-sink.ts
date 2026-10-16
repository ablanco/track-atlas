import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { EmailMessage } from "../../email/types";
export async function startEmailSink() {
  const token = randomBytes(32).toString("hex"), messages: EmailMessage[] = [];
  const server = createServer(async (req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { res.writeHead(403).end(); return; }
    if (req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(messages)); return; }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 65536) { res.writeHead(413).end(); return; } }
    try { messages.push(JSON.parse(body)); if (messages.length > 1000) messages.shift(); res.writeHead(201).end(); }
    catch { res.writeHead(400).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing sink address");
  return { url: `http://127.0.0.1:${address.port}`, token, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
