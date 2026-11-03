import type { Pool, PoolClient } from "pg";

/** Lose the database acknowledgment of a ready-file commit, regardless of how
 * many reservation/storage-lock transactions preceded publication. */
export function loseReadyFileCommit(pool: Pool) {
  const originals = new Map<PoolClient, PoolClient["query"]>();
  let lost = false;
  const acquire = (client: PoolClient) => {
    if (originals.has(client)) return;
    originals.set(client, client.query);
    let ready = false;
    client.query = new Proxy(client.query, {
      apply(target, thisArg, args) {
        const statement = typeof args[0] === "string" ? args[0] : args[0]?.text;
        const values = Array.isArray(args[1]) ? args[1] : args[0]?.values;
        if (typeof statement === "string") {
          if (statement.trim().toLowerCase() === "begin") ready = false;
          if (
            /update "stored_files" set/i.test(statement) &&
            Array.isArray(values) &&
            values.includes("ready")
          )
            ready = true;
        }
        const result = Reflect.apply(target, thisArg, args);
        if (
          !lost &&
          ready &&
          typeof statement === "string" &&
          statement.trim().toLowerCase() === "commit"
        ) {
          lost = true;
          return Promise.resolve(result).then(() => {
            throw new Error(
              "lost PostgreSQL ready-file commit acknowledgement",
            );
          });
        }
        return result;
      },
    });
  };
  pool.on("acquire", acquire);
  return () => {
    pool.off("acquire", acquire);
    for (const [client, query] of originals) client.query = query;
  };
}
