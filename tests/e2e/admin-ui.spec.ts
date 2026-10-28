import { test, expect } from "./fixtures";
for (const locale of ["en", "es"]) {
  test(`admin routes protect private UI (${locale})`, async ({ page }) => {
    for (const suffix of ["", "/users", "/tracks/%5B%22missing%22%5D"]) {
      const response = await page.goto(`/${locale}/admin${suffix}`);
      await expect(
        page.getByRole("heading", {
          name:
            locale === "en"
              ? "Administrator access required"
              : "Se requiere acceso de administrador",
        }),
      ).toBeVisible();
      expect(response?.headers()["cache-control"]).toContain("no-store");
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(
        page.getByRole("menuitem", {
          name: locale === "en" ? "Admin panel" : "Panel de administración",
        }),
      ).toHaveCount(0);
    }
  });
}

import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { selectTheme } from "./fixtures";
loadEnvConfig(process.cwd(), true);
for (const locale of ["en", "es"]) {
  test(`current admin menu, browsing and revocation (${locale})`, async ({
    page,
    context,
  }) => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const token = randomBytes(32).toString("base64url");
    let userId = "";
    try {
      userId = (
        await pool.query(
          "INSERT INTO users(first_name,last_name,email,password_hash,date_of_birth,admin) VALUES ('Admin','Browser',$1,'synthetic','1990-01-01',true) RETURNING id",
          [`admin-ui-${randomUUID()}@example.test`],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [userId, createHash("sha256").update(token).digest("hex")],
      );
      await context.addCookies([
        {
          name: "track_atlas_session",
          value: token,
          url: "http://127.0.0.1:3100",
        },
      ]);
      await page.goto(`/${locale}`);
      await page.getByRole("button", { name: /Admin B/ }).click();
      const link = page.getByRole("menuitem", {
        name: locale === "en" ? "Admin panel" : "Panel de administración",
      });
      await expect(link).toHaveAttribute("href", `/${locale}/admin`);
      await link.click();
      await expect(
        page.getByRole("heading", {
          name: locale === "en" ? "Overview" : "Resumen",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          locale === "en"
            ? "Loading current records…"
            : "Cargando registros actuales…",
        ),
      ).toHaveCount(0);
      const stats =
        locale === "en"
          ? [
              "Total users",
              "Active users",
              "Total tracks",
              "Public tracks",
              "Storage files",
              "Storage size",
            ]
          : [
              "Usuarios totales",
              "Usuarios activos",
              "Rutas totales",
              "Rutas públicas",
              "Archivos almacenados",
              "Tamaño del almacenamiento",
            ];
      for (const label of stats)
        await expect(
          page
            .getByRole("link")
            .filter({ has: page.getByText(label, { exact: true }) }),
        ).toBeVisible();
      await expect(
        page
          .getByRole("link")
          .filter({ has: page.getByText(stats[5], { exact: true }) }),
      ).toContainText(/0\s*B/);
      for (const heading of locale === "en"
        ? ["Active users over time", "Public tracks over time"]
        : [
            "Usuarios activos a lo largo del tiempo",
            "Rutas públicas a lo largo del tiempo",
          ]) {
        const chart = page.getByRole("region", { name: heading, exact: true });
        await expect(chart).toBeVisible();
        await expect(chart.locator(".recharts-line-curve")).toHaveCount(1);
        await expect(chart.getByRole("application")).toBeVisible();
      }
      await selectTheme(page, "dark");
      await selectTheme(page, "light");
      for (const model of [
        "captcha_uses",
        "track_upload_attempts",
        "deleted_track_uploads",
        "email_send_limits",
      ])
        await expect(
          page.locator(`a[href="/${locale}/admin/${model}"]`),
        ).toHaveCount(0);
      const models = [
        "users",
        "sessions",
        "account_action_tokens",
        "stored_files",
        "tracks",
        "track_data",
        "track_tags",
        "track_directional_representations",
        "track_lists",
        "track_list_memberships",
      ];
      for (const model of models) {
        await page.goto(`/${locale}/admin/${model}`);
        await expect(page.getByRole("table")).toBeVisible();
        await expect(
          page.locator('select[name="sort"] option[value="created_at"]'),
        ).toHaveText(locale === "en" ? "Created at" : "Creación");
        if (
          [
            "track_data",
            "track_tags",
            "track_directional_representations",
            "users",
          ].includes(model)
        )
          await expect(page.getByRole("checkbox")).toHaveCount(0);
      }
      const listId = (
        await pool.query(
          "INSERT INTO track_lists(owner_id,name,normalized_name) VALUES($1,'Admin browser list','admin browser list') RETURNING id",
          [userId],
        )
      ).rows[0].id;
      await page.goto(`/${locale}/admin/track_lists?owner_id=${userId}`);
      await page
        .getByRole("checkbox", {
          name:
            locale === "en"
              ? "Select current page"
              : "Seleccionar página actual",
        })
        .check();
      await expect(
        page.getByRole("button", {
          name: locale === "en" ? "Delete" : "Eliminar",
          exact: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole("button", {
          name: locale === "en" ? "Apply filters" : "Aplicar filtros",
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: locale === "en" ? "Delete" : "Eliminar",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("checkbox", {
          name:
            locale === "en"
              ? "Select current page"
              : "Seleccionar página actual",
        })
        .check();
      await page
        .getByRole("button", {
          name: locale === "en" ? "Delete" : "Eliminar",
          exact: true,
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "Admin browser list",
      );
      await page
        .getByRole("button", {
          name: locale === "en" ? "Cancel" : "Cancelar",
          exact: true,
        })
        .click();
      await page
        .getByRole("link", {
          name: locale === "en" ? "Details" : "Detalles",
          exact: true,
        })
        .click();
      await page
        .getByRole("textbox", {
          name: locale === "en" ? "Name" : "Nombre",
          exact: true,
        })
        .fill("Renamed admin list");
      await page
        .getByRole("button", {
          name: locale === "en" ? "Review changes" : "Revisar cambios",
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "Renamed admin list",
      );
      const mutation = page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/admin/mutations") &&
          request.method() === "POST",
      );
      await page
        .getByRole("button", {
          name: locale === "en" ? "Confirm changes" : "Confirmar cambios",
          exact: true,
        })
        .click();
      const mutationRequest = await mutation;
      expect(mutationRequest.headers()["x-admin-locale"]).toBe(locale);
      expect(mutationRequest.postDataJSON()).toEqual({
        model: "track_lists",
        operation: "update",
        ids: [JSON.stringify([listId])],
        values: { name: "Renamed admin list" },
      });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page
          .getByRole("definition")
          .filter({ hasText: /^Renamed admin list$/ }),
      ).toHaveCount(1);
      await page.goto(`/${locale}/admin/track_lists?owner_id=${userId}`);
      await page
        .getByRole("checkbox", {
          name:
            locale === "en"
              ? "Select current page"
              : "Seleccionar página actual",
        })
        .check();
      await page
        .getByRole("button", {
          name: locale === "en" ? "Delete" : "Eliminar",
          exact: true,
        })
        .click();
      const deletion = page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/admin/mutations") &&
          request.method() === "POST",
      );
      await page
        .getByRole("button", {
          name: locale === "en" ? "Confirm changes" : "Confirmar cambios",
          exact: true,
        })
        .click();
      expect((await deletion).postDataJSON()).toEqual({
        model: "track_lists",
        operation: "delete",
        ids: [JSON.stringify([listId])],
      });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.goto(`/${locale}/admin/users?q=${encodeURIComponent(userId)}`);
      await page
        .getByRole("link", {
          name: locale === "en" ? "Details" : "Detalles",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: locale === "en" ? "Review changes" : "Revisar cambios",
        }),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: locale === "en" ? "Back to results" : "Volver a resultados",
        })
        .click();
      await expect(page).toHaveURL(new RegExp("q=" + userId));
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page
          .getByText(locale === "en" ? "Browse models" : "Explorar modelos", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await pool.query("UPDATE users SET admin=false WHERE id=$1", [userId]);
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name:
            locale === "en"
              ? "Administrator access required"
              : "Se requiere acceso de administrador",
        }),
      ).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await page.getByRole("button", { name: /Admin B/ }).click();
      await expect(
        page.getByRole("menuitem", {
          name: locale === "en" ? "Admin panel" : "Panel de administración",
        }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await pool.query("UPDATE users SET admin=true WHERE id=$1", [userId]);
      await page.goto(`/${locale}/admin/users?q=${userId}`);
      await expect(page.getByRole("table")).toBeVisible();
      await pool.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(page.getByRole("table")).toHaveCount(0);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(
        page.getByRole("heading", {
          name:
            locale === "en"
              ? "Administrator access required"
              : "Se requiere acceso de administrador",
        }),
      ).toBeVisible();
    } finally {
      if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      await pool.end();
    }
  });
}
