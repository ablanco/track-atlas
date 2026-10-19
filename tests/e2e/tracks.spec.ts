import { expect, test, selectTheme } from "./fixtures";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import type { BrowserContext } from "@playwright/test";

loadEnvConfig(process.cwd(), true);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const owners = new Set<string>();
const gpx = Buffer.from(
  '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test"><trk><trkseg><trkpt lat="40" lon="-3"/><trkpt lat="40.001" lon="-3.001"/></trkseg></trk></gpx>',
);
test.afterAll(() => pool.end());
test.afterEach(async () => {
  for (const id of owners) {
    await pool.query("DELETE FROM tracks WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM stored_files WHERE owner_id=$1", [id]);
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
  }
  owners.clear();
});
async function account(
  context: BrowserContext,
  baseURL: string,
  confirmed = true,
) {
  const token = randomBytes(32).toString("base64url");
  const {
    rows: [user],
  } = await pool.query(
    "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,email_confirmed) VALUES('Ada','Lovelace',$1,'synthetic','1815-12-10',$2) RETURNING id",
    [`tracks-${randomUUID()}@example.test`, confirmed],
  );
  owners.add(user.id);
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
    [user.id, createHash("sha256").update(token).digest("hex")],
  );
  await context.addCookies([
    {
      name: "track_atlas_session",
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
async function fillTrack(page: import("@playwright/test").Page, en: boolean) {
  await page
    .getByLabel(en ? "Name" : "Nombre", { exact: true })
    .fill("Private ridge");
  await page
    .getByLabel(en ? "Description" : "Descripción", { exact: true })
    .fill("First line\n<script>plain text</script>");
  await page
    .getByLabel(en ? "GPX file" : "Archivo GPX", { exact: true })
    .setInputFiles({
      name: "ridge.gpx",
      mimeType: "application/gpx+xml",
      buffer: gpx,
    });
  await page
    .getByRole("combobox", { name: en ? "Activity type" : "Tipo de actividad" })
    .press("Enter");
  await expect(page.getByRole("option")).toHaveCount(16);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox")).toContainText(
    en ? "Hiking" : "Senderismo",
  );
  await page.getByRole("radio", { name: "3", exact: true }).check();
  await page
    .getByLabel(en ? "Tags" : "Etiquetas", { exact: true })
    .fill("High ridge");
  await page
    .getByLabel(en ? "Tags" : "Etiquetas", { exact: true })
    .press("Enter");
}
test("real HTTP server accepts a valid GPX multipart upload", async ({
  context,
  baseURL,
}) => {
  await account(context, baseURL!);
  const response = await context.request.post("/api/tracks", {
    headers: { origin: baseURL! },
    multipart: {
      name: "HTTP track",
      description: "Two positions",
      activity: "hiking",
      difficulty: "3",
      tags: JSON.stringify(["forest"]),
      requestId: randomUUID(),
      file: { name: "track.gpx", mimeType: "application/gpx+xml", buffer: gpx },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
});
for (const locale of ["en", "es"]) {
  const en = locale === "en";
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme} keyboard validation, retry retention and private original`, async ({
      page,
      context,
      request,
      baseURL,
    }) => {
      test.skip(
        !!process.env.TEST_BASE_URL,
        "Requires isolated local storage harness",
      );
      await account(context, baseURL!);
      if (theme === "dark")
        await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/${locale}`);
      await selectTheme(page, theme);
      await page.getByRole("button", { name: "Ada L.", exact: true }).click();
      await page
        .getByRole("menuitem", {
          name: en ? "Upload track" : "Subir recorrido",
        })
        .click();
      const submit = page.getByRole("button", {
        name: en ? "Upload track" : "Subir recorrido",
        exact: true,
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await expect(page.getByRole("combobox")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(
        page.getByRole("radio", { name: "1", exact: true }),
      ).not.toBeChecked();
      await fillTrack(page, en);
      await expect(
        page.getByRole("status").filter({
          hasText: en ? "Added High ridge." : "Se ha añadido High ridge.",
        }),
      ).toBeVisible();
      const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
      await tags.fill("ＨＩＧＨ ridge");
      await tags.press("Enter");
      await expect(
        page.getByText(
          en ? "This tag is already added." : "Esta etiqueta ya está añadida.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: en ? "Remove High ridge" : "Eliminar High ridge",
          exact: true,
        }),
      ).toHaveCount(1);
      await tags.fill("Coastal views");
      await tags.press("Enter");
      await page
        .getByRole("button", {
          name: en ? "Remove Coastal views" : "Eliminar Coastal views",
        })
        .click();
      await expect(tags).toBeFocused();
      await expect(
        page.getByRole("status").filter({
          hasText: en
            ? "Removed Coastal views."
            : "Se ha eliminado Coastal views.",
        }),
      ).toBeVisible();
      // Lose the first response after real publication, then retry through the same public HTTP boundary.
      let firstRequestId: string | undefined;
      let retryRequestId: string | undefined;
      let attempt = 0;
      await page.route("**/api/tracks", async (route) => {
        const body = route.request().postDataBuffer()!.toString();
        const id = body.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1];
        attempt++;
        if (attempt === 1) {
          firstRequestId = id;
          const response = await route.fetch();
          expect(response.status(), await response.text()).toBe(201);
          await route.abort("failed");
        } else {
          retryRequestId = id;
          await route.continue();
        }
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        en ? "temporarily unavailable" : "no está disponible temporalmente",
      );
      await expect(
        page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
      ).toHaveValue("Private ridge");
      await expect(
        page.getByLabel(en ? "GPX file" : "Archivo GPX"),
      ).not.toBeEmpty();
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/tracks/[0-9a-f-]{36}$`),
      );
      expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(retryRequestId).toBe(firstRequestId);
      await expect(
        page.getByRole("heading", { name: "Private ridge" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText("<script>plain text</script>", { exact: false }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("article")
          .getByText(en ? "Private" : "Privado", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("main")).toContainText("Ada L.");
      await expect(page.getByRole("main")).toContainText(
        en ? "Hiking" : "Senderismo",
      );
      await expect(page.getByRole("main")).toContainText("3 / 5");
      await expect(page.getByRole("main")).toContainText("High ridge");
      await expect(page).toHaveTitle(
        en
          ? "Track details — Track Atlas"
          : "Detalles del recorrido — Track Atlas",
      );
      expect(await page.locator("head").textContent()).not.toContain(
        "Private ridge",
      );
      const download = page.getByRole("link", {
        name: en ? "Download original GPX" : "Descargar GPX original",
      });
      const url = (await download.getAttribute("href"))!;
      const original = await context.request.get(url);
      expect(original.status()).toBe(200);
      expect(await original.body()).toEqual(gpx);
      expect(original.headers()["cache-control"]).toBe("private, no-store");
      const detailsURL = page.url();
      expect((await request.get(url)).status()).toBe(404);
      await account(context, baseURL!);
      expect((await context.request.get(url)).status()).toBe(404);
      await page.goto(detailsURL);
      await expect(
        page.getByRole("heading", {
          name: en ? "Track not found" : "Recorrido no encontrado",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
  test(`${locale} recoverable HTTP errors retain input and changed payload gets a fresh request`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveValue("Private ridge");
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await expect(page.getByRole("combobox")).toContainText(
      en ? "Hiking" : "Senderismo",
    );
    const ids: string[] = [];
    const replies = [
      { status: 422, body: { error: "unsupportedStructure" } },
      { status: 409, body: { error: "processing" } },
      {
        status: 422,
        body: { error: "invalidMetadata", fieldErrors: { name: "tooLong" } },
      },
      { status: 403, body: { error: "emailUnconfirmed" } },
      { status: 401, body: { error: "unauthorized" } },
    ];
    await page.route("**/api/tracks", async (route) => {
      ids.push(
        route
          .request()
          .postDataBuffer()!
          .toString()
          .match(/name="requestId"\r\n\r\n([^\r]+)/)![1],
      );
      const reply = replies[ids.length - 1];
      await route.fulfill({
        status: reply.status,
        contentType: "application/json",
        body: JSON.stringify(reply.body),
      });
    });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "exactly one track" : "exactamente un recorrido",
    );
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(
      page.getByLabel(en ? "Description" : "Descripción", { exact: true }),
    ).toHaveValue("First line\n<script>plain text</script>");
    await expect(page.getByRole("combobox")).toContainText(
      en ? "Hiking" : "Senderismo",
    );
    await expect(
      page.getByRole("radio", { name: "3", exact: true }),
    ).toBeChecked();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "still processing" : "sigue en proceso",
    );
    expect(ids[1]).toBe(ids[0]);
    await page
      .getByLabel(en ? "Name" : "Nombre", { exact: true })
      .fill("Changed ridge");
    await submit.click();
    await expect(
      page.getByLabel(en ? "Name" : "Nombre", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(ids[2]).not.toBe(ids[0]);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "Confirm your email" : "Confirma tu correo",
    );
    await expect(
      page
        .getByRole("main")
        .getByRole("alert")
        .getByRole("link", {
          name: en ? "Account settings" : "Ajustes de la cuenta",
        }),
    ).toBeVisible();
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "session expired" : "sesión ha caducado",
    );
    expect(ids[4]).toBe(ids[2]);
  });
  test(`${locale} required text and tag limits count Unicode characters`, async ({
    page,
    context,
    baseURL,
  }) => {
    await account(context, baseURL!);
    await page.goto(`/${locale}/tracks/upload`);
    await fillTrack(page, en);
    let submissions = 0;
    await page.route("**/api/tracks", async (route) => {
      submissions++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
    });
    const name = page.getByLabel(en ? "Name" : "Nombre", { exact: true });
    const description = page.getByLabel(en ? "Description" : "Descripción", {
      exact: true,
    });
    const tags = page.getByLabel(en ? "Tags" : "Etiquetas", { exact: true });
    const submit = page.getByRole("button", {
      name: en ? "Upload track" : "Subir recorrido",
      exact: true,
    });
    await name.fill("🥾".repeat(201));
    await description.fill("🌲".repeat(5001));
    await submit.click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(description).toHaveAttribute("aria-invalid", "true");
    expect(submissions).toBe(0);
    await tags.fill("🌲".repeat(31));
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(31)}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("🌲".repeat(30));
    await tags.press("Enter");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} ${"🌲".repeat(30)}`,
        exact: true,
      }),
    ).toBeVisible();
    for (let index = 1; index <= 8; index++) {
      await tags.fill(`Tag ${index}`);
      await tags.press("Enter");
    }
    await tags.fill("An eleventh tag");
    await tags.press("Enter");
    await expect(tags).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: `${en ? "Remove" : "Eliminar"} An eleventh tag`,
        exact: true,
      }),
    ).toHaveCount(0);
    await tags.fill("");
    await name.fill(` ${"🥾".repeat(200)} `);
    await description.fill(` ${"🌲".repeat(5000)} `);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      en ? "temporarily unavailable" : "no está disponible temporalmente",
    );
    expect(submissions).toBe(1);
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(description).toHaveAttribute("aria-invalid", "false");
  });
  test(`${locale} upload explains guest and unconfirmed eligibility`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto(`/${locale}/tracks/upload`);
    await expect(
      page.getByRole("link", {
        name: en ? "Create an account" : "Crear una cuenta",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: en ? "Upload track" : "Subir recorrido" }),
    ).toHaveCount(0);
    await account(context, baseURL!, false);
    await page.reload();
    await expect(
      page.getByRole("link", {
        name: en ? "Account settings" : "Ajustes de la cuenta",
      }),
    ).toBeVisible();
    await expect(page.getByLabel(en ? "GPX file" : "Archivo GPX")).toHaveCount(
      0,
    );
  });
}
