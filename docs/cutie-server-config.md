# cutie.richb-hanover.com — Server Configuration

**What it is:** a Svelte app served over HTTPS at `cutie.richb-hanover.com`, fronted
by Apache (under Virtualmin) which reverse-proxies to the Node app on port 5174.
Apache *also* listens on public port 5173 purely to redirect legacy visitors (who
used to hit the app directly on `:5173`) to the HTTPS URL.

**Architecture:**
```
Browser ──HTTPS:443─────> Apache (Virtualmin vhost) ──HTTP──> Node/Svelte app on 127.0.0.1:5174
Old user ─HTTP:5173─────> Apache (redirect vhost) ──301──> https://cutie.richb-hanover.com/
```
Apache terminates TLS and is the only thing exposed to the internet. The Node app
listens on localhost only (port 5174) and is never reached directly from outside.
Public port 5173 no longer serves the app — it only issues redirects.

---

## Port layout (important)

| Port | Bound to | Purpose |
|------|----------|---------|
| 443  | public (Apache) | HTTPS front door, terminates TLS, proxies to app |
| 5173 | public (Apache) | **redirect only** — sends old `http://IP:5173` visitors to the HTTPS URL |
| 5174 | `127.0.0.1` (Node) | the actual Svelte app, reachable only via Apache |

The app was moved off 5173 to 5174 so Apache could take over public 5173 for the
redirect. Apache and the app cannot both bind 5173 — hence the split.

---

## DNS

- `cutie.richb-hanover.com` — A record pointing at this server's public IP
  (`23.226.232.80`).

---

## Virtualmin / Apache — main HTTPS site

A normal Virtualmin virtual server hosts the domain (provides the vhost + Let's
Encrypt certificate through Virtualmin's standard flow).

### Required Apache modules (enable once)
```bash
sudo a2enmod proxy proxy_http
sudo systemctl restart apache2
```

### Proxy directives
Added to the domain's SSL (`*:443`) vhost via
**Virtualmin → Services → Configure Website → Edit Directives**:

```apache
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:5174/
ProxyPassReverse / http://127.0.0.1:5174/
```

- `ProxyPreserveHost On` — passes the original `Host` header through to the app.
- `ProxyPass` — forwards incoming requests to the local app (now on 5174).
- `ProxyPassReverse` — rewrites `Location`/redirect headers in responses back to the
  public domain so redirects land correctly.
- Uses `127.0.0.1` explicitly (not `localhost`) to avoid any localhost→IPv6 (`::1`)
  resolution ambiguity.

### TLS
Let's Encrypt certificate issued and renewed through Virtualmin
(**Server Configuration → SSL Certificate → Let's Encrypt**). Apache terminates TLS;
the proxied hop to the app is plain HTTP over localhost.

---

## Apache — legacy redirect on public port 5173

Old users who bookmarked `http://23.226.232.80:5173` are redirected to the HTTPS URL.
This is configured in the **Webmin** Apache module (not Virtualmin's per-domain UI),
because it's a bare port listener with no domain/cert/mail attached.

### 1. Make Apache listen on 5173
Webmin → **Servers → Apache Webserver → Global Configuration → Networking and
Addresses** → add port **5173** → apply. (Writes `Listen 5173` into the Apache config.)

### 2. Create the redirect-only virtual host
Webmin → **Servers → Apache Webserver → Create a new virtual server**:
- **Handle connections to address:** Any address (`*`)
- **Port:** 5173
- **Document Root:** any valid dir, e.g. `/var/www/html` (never actually served)
- **Server Name:** blank or the IP/hostname

Then **Edit Directives** on that vhost so the body is just:
```apache
<VirtualHost *:5173>
    Redirect 301 / https://cutie.richb-hanover.com/
</VirtualHost>
```

### 3. Apply changes
Use **Apply Changes** (top-right of the Apache module).

**Order of operations:** move the app to 5174 *first* (next section). Apache cannot
bind public 5173 while the Node app still owns it — starting Apache on 5173 first
gives an "address already in use" error.

---

## The Svelte app (upstream on 127.0.0.1:5174)

**Critical: the app must bind to `127.0.0.1:5174`, not the public IP, and not 5173.**

An earlier "Service Unavailable" (503) was caused by the app listening on
`23.226.232.80:5173` (public IP) while Apache proxied to localhost — connection
refused. Binding to localhost fixes it *and* keeps the app off the public internet
(reachable only through Apache's HTTPS front door). It now also moves to 5174 to free
public 5173 for the redirect vhost.

### If running built SvelteKit (adapter-node)
```bash
HOST=127.0.0.1 PORT=5174 node build
```

### If running the Vite dev server
Set `server.host` to `127.0.0.1` and `server.port` to `5174` in `vite.config.js`
(remove any `--host 0.0.0.0` or explicit-IP flag). Also add the domain to
`server.allowedHosts` or Vite rejects the proxied request:
```js
// vite.config.js
export default {
  server: {
    host: '127.0.0.1',
    port: 5174,
    allowedHosts: ['cutie.richb-hanover.com'],
  },
};
```
(For production, prefer the built adapter-node output over the dev server.)

---

## Verification

Confirm the app is listening on localhost:5174 (not the public IP, not 5173):
```bash
sudo ss -ltnp | grep -E '5173|5174'
# WANT:  127.0.0.1:5174  (node)  and  *:5173 / 0.0.0.0:5173  (apache)
# NOT:   23.226.232.80:5173  or  0.0.0.0:5174
```

Check the app end-to-end:
```bash
curl -sI https://cutie.richb-hanover.com | head
```

Check the legacy redirect works:
```bash
curl -sI http://23.226.232.80:5173/
# WANT:  HTTP/1.1 301 ... Location: https://cutie.richb-hanover.com/
```

If you get a 503 on the HTTPS site, check in this order:
1. Is the app running and on `127.0.0.1:5174`? (`ss` command above)
2. Apache error log: `sudo tail -20 /var/log/apache2/error.log`
   (or the per-site log under `/home/*/logs/error_log`)

---

## Notes / decisions

- **Why the redirect lives on Apache, not the app:** binding the app to localhost
  (the secure setup) means nothing answers on public 5173 anymore, so old visitors
  would just get a connection error. Apache takes over public 5173 to catch them and
  301 them to the HTTPS URL. Once those users have updated their bookmarks, the 5173
  listener and redirect vhost can be removed entirely.
- **Redirect only helps browsers.** A 301 on `http://IP:5173` is followed by web
  browsers. Programmatic/API clients hardcoded to `http://IP:5173` may not follow the
  redirect — if any old users are scripts rather than browsers, they need to be told
  the new URL directly.
- **Why Apache and not Caddy:** this box already runs Virtualmin with other working
  sites; Apache owns 80/443. Bringing in Caddy would mean demoting Apache off those
  ports and proxying every existing site through Caddy — unnecessary risk for one app.
  Apache's `mod_proxy` does the same reverse-proxy job. Virtualmin keeps managing the
  vhost and the Let's Encrypt cert normally.
- **Websockets:** if the app uses websockets (Vite HMR in dev, or live features),
  also `sudo a2enmod proxy_wstunnel` and add an upgrade rule to the SSL vhost:
  ```apache
  RewriteEngine On
  RewriteCond %{HTTP:Upgrade} websocket [NC]
  RewriteCond %{HTTP:Connection} upgrade [NC]
  RewriteRule ^/?(.*) "ws://127.0.0.1:5174/$1" [P,L]
  ```
- **Keeping the app running:** make sure the Node app is started by something that
  survives reboots/crashes (systemd service, pm2, etc.) rather than a bare shell —
  otherwise a reboot brings back the 503.
