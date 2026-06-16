# Developing Cutie Network Quality Test

Install dependencies
then start a development server:

```sh
npm install
npm run dev # Start develpment server on port 5173

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Testing

Before committing new code, ensure that
there are no errors or warnings when you run:

- `npm run check`
- `npm run lint`
- `npm test` #_This isn't implemented yet_

## Building for production

**Use the `deploy.sh` script:** that is designed
to run the build steps (below)
that is designed to recover from errors.
It also detects running instances of Cutie and asks if they
should be terminated.
To run the script:

```bash
sh deploy.sh
... or...
sh deploy.sh branch-to-checkout
```

This starts the `npm run preview` server running on
port 4173.

The Apache server is configured to run a proxy
(with Let's Encrypt handling SSL)
to listen for https://cutie.richb-hanover.com
(or whatever DNS name) and proxy it to port 4173.

See _docs/cutie-server-config.md_ for Apache details.

## Bringing dependencies up to date

`npx npm-check-updates` reviews the package.json file to display
updated packages. Adding `-u` brings them up to date.

**This is a big deal.** Only do this prior to making a major change
when you're willling to deal with breakage.

## Debugging tips

- Add `?chartTest=1` to insert test data into the chart
- Need to devise test cases that inject known data to verify
  the processing
- Query `/api/stats` to return current running stats
