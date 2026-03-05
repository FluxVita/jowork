# Custom Domain Setup

Jowork supports three ways to expose your gateway beyond `localhost`:

## 1. LAN Access (built-in)

Your gateway is automatically discoverable on the local network via mDNS.
Any device on the same Wi-Fi/LAN can connect to:

```
http://<your-local-ip>:18800
```

Run `GET /api/network/info` to get your current LAN URLs:

```bash
curl http://localhost:18800/api/network/info
```

## 2. Cloudflare Quick Tunnel (built-in, no account needed)

Start a temporary public HTTPS URL via the admin API:

```bash
# Start tunnel (requires cloudflared installed)
curl -X POST http://localhost:18800/api/admin/tunnel/start

# Check status
curl http://localhost:18800/api/admin/tunnel/status

# Stop tunnel
curl -X POST http://localhost:18800/api/admin/tunnel/stop
```

The tunnel URL looks like `https://abc-xyz.trycloudflare.com`.
**Note:** Quick tunnels are temporary and reset on restart.

### Installing cloudflared

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/cloudflare-main.gpg
echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

# Windows
winget install Cloudflare.cloudflared
```

## 3. Persistent Custom Domain (Cloudflare Tunnel with account)

For a permanent URL like `jowork.your-domain.com`:

1. Create a free Cloudflare account and add your domain.
2. Install and authenticate cloudflared:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create jowork
   ```
3. Create a tunnel config at `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <your-tunnel-id>
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: jowork.your-domain.com
       service: http://localhost:18800
     - service: http_status:404
   ```
4. Add a DNS CNAME: `jowork.your-domain.com → <tunnel-id>.cfargotunnel.com`
5. Start the tunnel:
   ```bash
   cloudflared tunnel run jowork
   ```

## 4. Reverse Proxy (nginx / Caddy)

If you already run a reverse proxy on your server:

**Caddy** (`Caddyfile`):
```
jowork.your-domain.com {
    reverse_proxy localhost:18800
}
```

**nginx** (`/etc/nginx/sites-available/jowork`):
```nginx
server {
    listen 443 ssl;
    server_name jowork.your-domain.com;

    location / {
        proxy_pass http://localhost:18800;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Security Notes

- Always use HTTPS when exposing Jowork over the internet.
- Set `JWT_SECRET` to a strong random value in production.
- Consider restricting `/api/admin/*` endpoints with an additional auth layer if your gateway is public.
