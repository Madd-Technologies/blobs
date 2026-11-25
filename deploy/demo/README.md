# Reviewer-Only Demo Server (Hydra + Docker + Cloudflare Tunnel)

Hardened, zero-LLM-spend deployment of the 5-bot demo world ([docs/DEMO.md](../../docs/DEMO.md)) for **Apple App Store** and **Google Play** reviewers.

## Architecture & Security Controls

```text
App Reviewer (iOS / Android)
  │  HTTPS / WSS
  ▼
Cloudflare Edge (DDoS protection, optional WAF rate limits)
  │  Outbound-only Cloudflare Tunnel
  ▼
[edge-net]
  cloudflared ──► nginx (unprivileged, read-only rootfs, rate & WS limits, route allowlist)
                    │
                    ▼
[demo-internal (Docker internal: true — ZERO internet / LAN / Tailscale egress)]
  hermes-demo (non-root UID 10001, cap_drop: ALL, 2 CPU / 2.5 GB RAM / 256 PIDs)
    ├── demo-llm.mjs (127.0.0.1:9220 — scripted responses, no API keys)
    ├── hermes gateway run
    ├── hermes dashboard (0.0.0.0:9219)
    └── Scout Bot Screen (native Linux Xvnc + minimal Xfce + Chromium, no terminal/sudo)
```

- **Zero host socket exposure:** Runs Bot Screen natively inside the Linux container (`bot_desktop.placement: gateway`), so Hydra's Docker socket is never mounted.
- **Zero egress from `hermes-demo`:** `demo-internal` has `internal: true`, so even Scout's live Chromium browser cannot reach the internet, Hydra's LAN, or your Tailscale `100.64.0.0/10` network.
- **Nginx protections ([nginx.conf](nginx.conf)):**
  - Restores real client IP from `CF-Connecting-IP` (only trusting `edge-net` `172.31.0.0/24`) and rewrites `X-Forwarded-For` to `$remote_addr`.
  - Rate-limits `/login`, `/auth/*`, and `/api/auth/ws-ticket` to `5 req/min` per IP (`burst=8`).
  - Rate-limits `/api/*` to `120 req/min` per IP (`burst=40`) and caps body size at `5m`.
  - Caps WebSockets (`/api/ws`, `/api/display/ws`) to `10` concurrent per IP and `40` total.
  - Returns `403` on ops, plugin/skill installers, MCP config, host desktop install, and gateway stop/restart routes.
  - Returns `404` on `/` so random web scanners cannot browse the Hermes web SPA.

---

## 1. Lock Down Hydra's Firewall

Keep Hydra completely closed to the public internet (Cloudflare Tunnel connects outbound only):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

---

## 2. Create the Cloudflare Tunnel

In **Cloudflare One → Networks → Tunnels**:

1. Create a **Cloudflared** tunnel (e.g., `blobs-demo`) and copy the tunnel token.
2. Add a **Public Hostname**:
   - **Subdomain / Domain:** `demo.blobs.maddtechnologies.com`
   - **Service Type:** `HTTP`
   - **URL:** `nginx:8080`
3. *(Recommended)* In Cloudflare **Security → WAF → Rate limiting rules**, add a backup edge rule for `http.host eq "demo.blobs.maddtechnologies.com"` on `/auth/` and `/login` (e.g., 15 requests / 10 seconds → Block).

---

## 3. Deploy on Hydra

From the `blobs` repository checkout on Hydra:

```bash
cd deploy/demo
cp .env.example .env
# Edit .env and set CLOUDFLARE_TUNNEL_TOKEN (and optionally DEMO_PASSWORD)
chmod 600 .env

docker compose up -d --build
```

Monitor first-boot seeding (takes ~1–2 minutes):

```bash
docker compose logs -f hermes-demo
```

Verify all 5 bots and Scout's Bot Screen are ready:

```bash
docker compose exec hermes-demo /opt/blobs-demo/entrypoint.sh status
```

Print the generated reviewer credentials (over SSH only):

```bash
docker compose exec hermes-demo /opt/blobs-demo/entrypoint.sh password
```

---

## 4. Operations & Nightly Reset

Reset the demo world back to its clean seeded state (keeps the same login password and token secret):

```bash
docker compose exec hermes-demo /opt/blobs-demo/entrypoint.sh reset
```

Optional nightly reset via root/user crontab (`crontab -e`):

```cron
0 4 * * * cd /path/to/blobs/deploy/demo && docker compose exec -T hermes-demo /opt/blobs-demo/entrypoint.sh reset >/dev/null 2>&1
```

Shut down cleanly once App Store / Play Store review is approved:

```bash
docker compose down
```

---

## 5. App Review Notes Template

Paste into **App Store Connect → App Review Information** and **Google Play Console → App access** (fill in the credentials printed by `entrypoint.sh password`):

> **Demo Server Access**
>
> Blobs is a client for self-hosted Hermes Agent gateways (commonly run on a user's private LAN or Tailscale network). For review, we host a dedicated sandboxed demo server populated with 5 sample bots, dashboards, a group room, pending approval/clarify items, and a live Bot Screen:
>
> - **Server URL:** `https://demo.blobs.maddtechnologies.com`
> - **Username:** `demo`
> - **Password:** `<from entrypoint.sh password>`
>
> On the Connect screen, tap **Use a username and password** (or enter the Server URL and tap **Connect** to switch automatically), then enter the credentials above.
>
> **Feature walkthrough once signed in:**
> - **Needs you:** Review Courier's pending command approval and Scout's 3-option question.
> - **Screens:** Open Scout's screen to watch the live remote desktop and tap **Take over** to interact with the sample storefront preview.
> - **Dashboards & Rooms:** View Courier/Scout/Forge pinned dashboards and the "Launch week" multi-bot room.
