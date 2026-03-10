# Checklist prior to release

Do these steps before a final push to the production server

- Update CHANGELOG to document the interesting changes
- Ensure that the `version` in _package.json_ is up to date
- Close all files in VSCode (to ensure they're all saved)
- `npm install` (Fix any vulnerabilities with `audit fix`)
- `npm run check`
- `npm run lint`
- Fix any problems
- Run any other manual tests
- (When everything is fine) Merge into `main` (if needed)
- Commit and push to Github

## On the production server

- Use `sh deploy.sh` to start up the Cutie server.
  This pulls from the repo, then runs
  `npm install`, `npm run build`, and `npm run preview`
  with the proper set of options for a long-running server.
- NB: The `deploy.sh` script also can take a parameter that is
  the name of a branch to checkout, instead of the default `main`
