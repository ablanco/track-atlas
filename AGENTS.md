# Repository guidance

## Project purpose

Track Atlas is a website for users to store GPX tracks, view them on an
interactive map, and search their track collection, including spatial search.

## Required stack

- Use Next.js as the application framework.
- Use TypeScript for application code.
- Use pnpm for dependency management and package scripts; do not introduce npm
  or Yarn lockfiles.
- Use Tailwind CSS for styling.

## Current state

The application has not been scaffolded yet. No package scripts, build commands,
or test commands are currently defined. Do not document commands as available
until they exist in the repository.

## Working conventions

- Communicate with the user in English.
- Write documentation, code comments, and Git commit messages in English.
- Keep changes focused on the requested task and preserve existing user work.
- Follow the structure and conventions of surrounding code as the project grows.
- Do not assume a database, authentication service, map provider, or GPX parsing
  library has been selected; confirm these choices when they become relevant.
- Keep README.md current when setup, scripts, or project capabilities change.

## Verification

- For documentation changes, check accuracy, Markdown formatting, and local links.
- Once application tooling exists, run the relevant checks using pnpm and the
  scripts defined in package.json before claiming changes are verified.
- Report which checks were run and any checks that could not be run.
