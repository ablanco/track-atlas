# Legal pages and account acknowledgment

Status: approved for implementation. Shared understanding confirmed on
2026-11-03 after the design interview.

## Confirmed decisions

- Track Atlas is a brand operated by Alejandro Blanco in Spain. Public postal
  address: Calle Victoria Kent, 1. San Juan de Aznalfarache, Spain.
- General contact: info@trackatlas.net. Privacy contact: privacy@trackatlas.net.
- Write original English and Spanish Terms and Conditions and Privacy Policy
  covering current Track Atlas features, with Wikiloc's documents as structural
  inspiration. Do not import unrelated Wikiloc products or subscriptions.
- Signup requires two separate, initially unchecked boxes: "I accept the Terms
  and Conditions" and "I have read the Privacy Policy". Enforce both server-side.
  Privacy acknowledgment is distinct from consent to optional processing.
- Store the terms version, privacy-policy version, timestamp, and language with
  the account. Preserve the corresponding document versions so the evidence
  identifies the documents presented to the user.
- Existing users receive a dedicated acceptance step when they next sign in.
  Do not infer historical acceptance.
- Add footer links and keep legal documents accessible from the explorer through
  a compact menu, because the explorer hides the footer.
- Accounts are restricted to people aged 18 or older, enforced at signup.
  No existing-underage-account migration is needed: the production database
  does not yet exist. This does not remove the previously agreed legal-document
  acceptance requirement for existing accounts and sessions.
- Users retain ownership of uploads and grant Track Atlas permission to store,
  process, display, and share them according to visibility. Public downloads
  permit personal use without automatically allowing commercial reuse or
  republication. Downloaded copies cannot be recalled.
- privacy@trackatlas.net handles access, correction, and erasure requests
  manually. Describe deactivation as retention, not deletion. Do not promise
  automatic erasure or an operational deadline without an established process;
  this does not remove applicable statutory obligations.
- Production providers: DigitalOcean hosting in Amsterdam, Cloudflare CDN,
  Backblaze storage in eu-central-003, and Brevo email. No backups or server-log
  retention are currently planned by the operator; do not infer that providers
  retain no operational data or that all runtime logging is disabled.
- Require existing users to complete the acceptance step before using
  authenticated features, including through existing sessions. Legal pages,
  logout, and privacy-request information remain accessible. Preserve the
  intended destination after successful acceptance.
- Material terms changes require renewed acceptance; material privacy changes
  require renewed acknowledgment. Typo-only corrections do not interrupt users.
  Preserve historical records and corresponding document versions.
- Spanish is the reference text if translations differ. Use Spanish governing
  law while preserving applicable consumer rights, with complete EN/ES versions.
- Implement an account-deletion command manually invoked by staff after handling
  an email request. This is part of the feature scope; there is no self-service
  account-deletion UI or public deletion endpoint.
- Delete the account, uploads (including originals and derivatives), owned
  tracks, lists, votes, authored comments/replies, sessions, account links, and
  person-linked legal acceptance records. Owned-track deletion also removes
  other users' discussion and memberships on those tracks; authored-comment
  deletion also removes the attached owner's reply. Do not retain an anonymized
  account. The email becomes available for registration again after completion.
- Keep historical legal documents independently of deleted acceptance records.
- Deletion is phased and resumable: first block access and revoke sessions, then
  remove content and finish physical storage cleanup before final database
  removal. Preserve enough cleanup bookkeeping to handle failed removals and
  in-flight uploads safely. Report pending until cleanup is complete; rerunning
  the command resumes safely. Do not report physical erasure while it is pending.
- Staff verify control of the registered email before invoking deletion. The
  command provides a dry run, requires explicit confirmation of the account ID,
  and refuses deletion of the last active administrator.
- Staff separately handle the request email and necessary provider follow-up.
  The command handles application data and stored files; it does not retract
  already-delivered messages or erase every provider-held operational record.
- Preserve existing anti-abuse windows and shared sending protections rather
  than resetting them during account deletion. Counters becoming ineffective
  after their window is distinct from physical pruning of database records;
  the operator procedure must describe maintenance for expired records.

## Delivery and verification

- Implement localized legal pages, permanent legal navigation, signup validation,
  versioned evidence, acceptance gates, and the staff deletion command.
- Update ARCHITECTURE.md with implemented behavior and security/data boundaries;
  update README.md with command usage, resumable cleanup, and staff procedures.
- Read relevant installed Next.js guides before application edits. Preserve
  request-time authentication boundaries, atomic CAPTCHA consumption, database
  replay protection, and account-token/session security.
- Test age boundaries, both unchecked-box rejection paths, version changes,
  stale/missing acceptance and active sessions, and safe destinations after
  acceptance. Cover deletion cascades, last-admin protection, rollback/races,
  in-flight uploads, storage failures and retries, and truthful pending/completed
  status. Use a migrated development database and mocked/capture-only email.
- Run pnpm lint, pnpm exec tsc --noEmit, pnpm build, and relevant auth, database,
  storage, track, and browser suites. Check English/Spanish, both themes, and
  hydration for shared UI. Report any checks not run or failing.
- Implementation is authorized; track delivery through GitHub Issues.

## References

- [Wikiloc terms](https://es.wikiloc.com/wikiloc/terms_es.html?v=6.1)
- [Wikiloc privacy policy](https://es.wikiloc.com/wikiloc/privacy_es.html?v=4.3)
- [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679)
- Current behavior: ARCHITECTURE.md, GLOSSARY.md, and docs/adr/.
