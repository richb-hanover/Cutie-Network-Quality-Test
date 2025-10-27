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
- Hide the Recent Probes panel;
  toggle `SHOW_RECENT_PROBES_HISTORY` to make it visible

## Origin Story

I was quite taken by the
[VSee Network Stability Test](https://test.vsee.com/network/index.html)
and its use of a WebRTC connection to make fine-grained
measurements of latency and packet loss.
This project was first created by using
`npx vs WebRTC-Stability-Test`.
I then used
[vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/)
(as described by Simon Willison)
to iterate the design.
