# Development of WebRTC Network Stability Test

## Origin Story

I was quite taken by the
[VSee Network Stability Test]()
and its use of a WebRTC connection to make fine-grained
measurements of latency and packet loss.
This project was first created by using
`npx vs WebRTC-Stability-Test`.
I

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Debugging tips

- Add `?chartTest=1` to insert test data into the chart
- Hide the Recent Probes panel;
  toggle `SHOW_RECENT_PROBES_HISTORY` to make it visible
