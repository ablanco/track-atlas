# Documentation

Start with the root [README](../README.md) to install and run Track Atlas.
For implemented behavior, read the [architecture overview](../ARCHITECTURE.md)
and its topic references. GitHub Issues hold active specs and delivery tickets.

## Guides and references

| Task                                                         | Document                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Install and run locally                                      | [Quick start](../README.md#setup)                                                                                |
| Configure database, email, storage, maps, or deployment      | [Configuration and operations](operations.md)                                                                    |
| Build and deploy release packages on a VPS                   | [VPS deployment](deployment.md)                                                                                  |
| Use uploads, collections, lists, maps, photos, or discussion | [Feature guide](features.md)                                                                                     |
| Select and run checks safely                                 | [Testing and verification](testing.md)                                                                           |
| Handle verified permanent account deletion                   | [Staff erasure runbook](account-erasure.md)                                                                      |
| Understand implementation and security boundaries            | [Architecture overview and topics](../ARCHITECTURE.md)                                                           |
| Use domain vocabulary                                        | [Glossary](../GLOSSARY.md)                                                                                       |
| Understand accepted tradeoffs                                | [Architecture decisions](adr/README.md)                                                                          |
| Follow contributor workflow                                  | [Contributor guidelines](../AGENTS.md)                                                                           |
| Review release history                                       | [Changelog](../CHANGELOG.md)                                                                                     |
| Work with tickets, triage labels, or domain docs             | [Issue tracker](agents/issue-tracker.md), [labels](agents/triage-labels.md), [domain guidance](agents/domain.md) |
| Apply the agreed visual identity                             | [Brand theme](brand-theme.md)                                                                                    |

## Assets and test fixtures

- [Homepage photograph attribution](../public/images/ATTRIBUTION.md).
- [Synthetic multi-track GPX fixtures](../tests/fixtures/gpx/README.md).
- [Synthetic map tile provenance](../tests/fixtures/maps/README.md).

## Product intent and historical material

[Product design](DESIGN.md) records the original product vision. It contains both
implemented ideas and future proposals; use current architecture to determine
what exists. [Historical designs and research](history.md) preserve requirements,
experiments, and earlier verification results. Their commands, checklists, and
provider observations describe the work at that time.

## Keeping documentation current

- Put implementation contracts and security behavior in the relevant architecture topic.
- Put setup, configuration, and operator commands in the operations reference;
  keep the root README focused on getting started.
- Put suite selection and harness requirements in the testing guide.
- Record terminology in the glossary and decision rationale in an ADR.
- Track new work in GitHub Issues; retain completed plans as historical records.
- Add new guides and references to this index and update links when moving content.

Published legal text and its revision registry are append-only. Documentation
cleanup must preserve those records; see the [legal revision contract](architecture/legal-and-erasure.md#public-legal-documents-and-revision-contract).
