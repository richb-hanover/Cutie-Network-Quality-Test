# Developing WebRTC Network Stability Test

Install dependencies with `npm install`
then start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Testing

Before committing new code, ensure that
there are no errors or warnings when you run:

- `npm run check`
- `npm run lint`
- `npm test` #_not yet_

## Building for production

To create a production version of the app:

```sh
npm install # install new dependencies; update package-lock.json
npm ci # clean install - uses package-lock.json to replace node-modules
# run all tests (above)
# fix any problems
npm run build
npm run preview
# to run the production build on port 5173 to mimic "npm run dev"
# npm run preview --port 5173
```

> To deploy your app, you may need to install an
> [adapter](https://svelte.dev/docs/kit/adapters)
> for your target environment.

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
