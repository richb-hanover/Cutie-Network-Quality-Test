# Theory of Operation

## How the VSee Network Stability Test works

The code establishes a connection to an RTC server endpoint and measures the responses.

The original code makes a POST request to
[the VSee server](https://test.vsee.com/network/connections)
and receives a blob of JSON that gives the ID of the
RTC thingie that we could talk to.

This fetch() call fails because of a CORS error. (test.vsee.com is not configured to allow "*" to connect, only its own pages.)

Making the request manually (in a browser) and pasting the response into
the code moves to the next error message, which is: `WebRTC: ICE failed, add a TURN server and see about:webrtc for more details`

But if we could set up our own server running on `localhost`, or on
`foo.local`, or even on `vseetest.mydomain.com`
to serve the pages and host the RTC server, this could be useful.

I asked ChatGPT to review this code and suggest an RTC server implementation.

Also used [webcrack](https://webcrack.netlify.app/) to break out modules
from the index.js file.
This removed thousands of lines of code
(which were all the bundled dependencies) from the original _index.js_ file.
Webcrack also seems to convert CJS `require()` to `import` statements.
It may also have produced the _package.json_ file.

## rtcClient.js

This code sends a POST `/connections` and
(optionally) receives back credentials to be added
to the `iceservers` array. 

## Development Strategies

* Must bind to `0.0.0.0` in development mode for Firefox.
  Chrome and Safari are less strict about addresses:
  Use: `npm run dev --host 0.0.0.0 --port 5173`
  
  
