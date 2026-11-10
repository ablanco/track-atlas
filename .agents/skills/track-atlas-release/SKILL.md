---
name: track-atlas-release
description: Prepare Track Atlas releases, update their version and changelog, or publish release packages through GitHub Actions. Use for release work in this project; VPS provisioning is covered by the deployment guide.
---

# Track Atlas releases

Run commands from the repository root. Read [deployment](../../../docs/deployment.md)
for the current build, publication, and recovery contract, and
[testing](../../../docs/testing.md) for verification. Check the current
`.github/workflows/release-build.yml` and `deploy-vps.yml` when verifying workflow
behavior.

Use the available shell or GitHub integration for repository and release
operations. Commands below describe the required behavior; equivalent tools are
fine. This workflow requires no particular agent harness or model.

## Establish scope

Distinguish preparation (version, changelog, verification), publication (tag and
GitHub release), and deployment. Follow the user's requested scope and existing
authorization. A request to update the changelog or prepare a release does not
authorize publishing. Publishing a stable release currently triggers **build →
asset publication → production deployment**, including migrations and a service
restart. Explain this consequence before publishing; if deployment is outside the
authorized scope, finish preparation and leave publication pending.

## Prepare

1. Inspect the working tree and fetch remote branches and tags. Preserve unrelated
   changes. Use a dedicated release branch from the intended `master` commit;
   do not include unrelated branch work in the release.
2. Identify the previous published release and its tag. Compare its commits and
   diff with the intended release commit, rather than assuming the current
   `package.json` version or changelog describes everything shipped. Check local
   and remote tags and existing GitHub releases for the requested version.
3. Set `package.json` to the requested Semantic Version. Stable release tags must
   be exactly `vMAJOR.MINOR.PATCH` and match that file. Internal unreleased version
   bumps may need consolidation into the requested release version; never move
   an existing published tag to accommodate a mismatch.
4. Update the root `CHANGELOG.md`, preserving historical entries. Follow its
   `## VERSION — YYYY-MM-DD` format and Added/Changed/Fixed sections as applicable.
   Complete an existing entry for this version rather than duplicating it.
   Summarize observable improvements and relevant maintenance work from the full
   release diff; omit merge-commit noise and unsupported claims. Use the actual
   release date when publishing, and recheck it if preparation spans days.
5. Check migration changes since the previous release. Before stable publication,
   verify a current database backup and migration compatibility with both the
   running application and the rollback version, as required by the deployment
   guide. Incompatible migrations need its maintenance procedure. Do not run
   production migrations from the development checkout.
6. Run lint, TypeScript checks, production build, release-tooling tests
   (`node --test tests/release/*.test.mjs`), and suites relevant to the release
   changes. Reuse current verification evidence when it still applies; report
   failures and omitted checks. For build-only configuration, follow the workflow's
   trusted HTTPS `APP_ORIGIN` and placeholder `DATABASE_URL`; a production build
   needs no live database. Leave dependency install scripts enabled so the
   required Next.js patches apply. Use migrated development databases and capture
   email for suites that need them.
7. Review the final diff and version/changelog agreement. Commit the preparation
   when requested and integrate it into `master` using the requested repository
   workflow before tagging. The tag must point to the verified release commit.

## Publish when authorized

- Recheck remote state, the intended commit, and tag/release availability before
  creating anything. Push only the intended branch and tag; do not force-push or
  move existing release tags.
- Publish a GitHub release for that exact tag with notes taken from its changelog
  section. Verify that the remote tag already exists and preserve the notes'
  formatting. For example, `gh release create` supports `--verify-tag` and
  `--notes-file`.
  A draft does not start the published-release workflow. Do not label a stable
  release as a prerelease merely to bypass deployment.
- Follow build, asset publication, and deployment results. Report the release
  URL, tag and commit, checks, assets, and deployment status accurately. Publication
  alone does not prove the package was built or deployed successfully.

## Failed or repeated operations

Inspect existing tags, releases, assets, and workflow runs before retrying an
operation whose outcome is uncertain. Stop on an existing conflicting tag,
asset, or failed deployment and report the evidence; do not repeatedly mutate
remote state or overwrite artifacts to make the retry succeed.

Manual **Build VPS release** dispatch on `master` packages an existing tag using
the selected branch's tooling and never deploys. Existing asset names cannot be
overwritten. Manual **Deploy VPS release** uses existing stable assets and defaults
to `check_only`; actual activation requires deployment authorization. Follow the
deployment guide for recovery: avoid cancelling running deployments, never delete
the active release, and remember that application rollback does not undo migrations.
