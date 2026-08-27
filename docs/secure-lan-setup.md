# Secure LAN Setup Checklist

Use this flow when you want to open DeskCue from another device or browser on
the same LAN.

## Checklist

1. Start DeskCue from the host computer

   ```bash
   npm run start
   ```

2. Open the local settings page on the host computer

   ```text
   http://127.0.0.1:4100/settings?tab=access
   ```

3. Under Connections → Access protection, enable `Require access token`

4. Under Connections → Pair devices, create a device pairing link

5. Open that pairing link from the target device or browser

6. Confirm `/settings` shows:

   - access protection: `On`;
   - exposure: `LAN exposed` or stricter;
   - token source: `Device tokens`

7. Use `Forget this browser` to revoke the current browser token and remove the
   local browser copy

8. Use `Revoke other devices` when a device, browser, or copied link should no
   longer have access. DeskCue revokes other active device tokens and keeps the
   current browser paired; existing other clients need a new pairing link

## Optional Hardening

- Set `DESKCUE_BIND_HOST=127.0.0.1` when you only use DeskCue from the host
  computer
- Set `DESKCUE_PUBLIC_HOST` when the LAN address should be stable in generated
  pairing links
- Keep `DESKCUE_ALLOWED_ORIGINS` narrow when using non-default web origins
- Add `http://<your-lan-ip>:4173` to `DESKCUE_ALLOWED_ORIGINS` only when using
  `npm run dev` with the Vite dashboard
- Do not expose DeskCue directly to the public internet

## Reverse Proxies

DeskCue does not currently provide a full trusted-proxy mode. It does not trust
arbitrary forwarded headers from LAN clients, and one-time pairing link creation
needs to originate from the host side or an already paired device.

If you put DeskCue behind nginx, Caddy, Tailscale Funnel, or another proxy:

- keep `DESKCUE_AUTH_REQUIRED=true`;
- terminate HTTPS at the proxy;
- add proxy-level access controls when the proxy is public;
- set `DESKCUE_PUBLIC_HOST` to the browser-facing origin used in pairing links;
- route `/api` and `/ws` to the daemon, not only `/` to the web app;
- expose both the dashboard port and the separate Preview proxy port with the
  same browser-facing scheme (`https` for both when using HTTPS);
- keep the daemon itself bound to the smallest network surface that still works

With `DESKCUE_PUBLIC_HOST=https://deskcue.example.com`, device pairing links use
`https://deskcue.example.com/pair/<code>`. The browser pairs through same-origin
`/api`, so devices do not need direct access to daemon port `4100`.

Preview content intentionally uses a different browser origin from the DeskCue
dashboard. With the default ports, an HTTPS ingress should map both listeners:

```text
https://<trusted-host>:4100 -> http://127.0.0.1:4100
https://<trusted-host>:4101 -> http://127.0.0.1:4101
```

Both browser-facing URLs must use HTTPS for Preview applications that require
secure-context APIs such as Web Crypto, Service Worker, WebAuthn, or camera
access. DeskCue does not emulate these browser APIs on an insecure HTTP origin.
The local upstream applications may continue to use HTTP because TLS terminates
at the trusted ingress. For example, Tailscale Serve can terminate HTTPS for
both ports while forwarding them to the two loopback listeners.
