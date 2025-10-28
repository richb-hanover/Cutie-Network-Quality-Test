# Developing WebRTC Network Stability Test

Install dependencies with `npm install`
then start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building for production

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an
> [adapter](https://svelte.dev/docs/kit/adapters)
> for your target environment.

## Testing

Before committing new code, ensure that
there are no errors or warnings when you run:

- `npm run check`
- `npm run lint`
- (soon) `npm test`

## Debugging tips

- Add `?chartTest=1` to insert test data into the chart
- Need to devise test cases that inject known data to verify
  the processing
