# Checklist prior to release

Do these steps before a final push to the production server

- Update CHANGELOG to document the interesting changes
- Ensure that the `version` in _package.json_ is up to date
- `npm install`
- `npm run check`
- `npm run lint`
- Fix any problems
- Run some manual tests
- Close all files in VSCode (to ensure they're all saved)
- (When everything is fine) Merge into `main` (if needed)
- Commit and push to Github

## On the production server

- Pull `main` branch from Github
- `npm install` to pull in any new dependencies
- `sh run-dev.sh` **OR**
- `sh deploy.sh` to start up the server
