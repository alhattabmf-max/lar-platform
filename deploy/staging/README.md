# LAR permanent staging

This stack is intentionally separate from local development and production.

It runs the Next.js web app, NestJS API, worker, PostgreSQL, Redis, MinIO and
Caddy on one small cloud server. Only ports 80 and 443 are public. Caddy adds
HTTPS and an extra review password before the platform's own authentication.

## First deployment

1. Create a 4 GB Ubuntu Droplet and point a subdomain to its IPv4 address, or
   use `<IPv4-with-dashes>.sslip.io` temporarily.
2. Install Docker Engine and the Compose plugin.
3. Copy the repository to `/opt/lar-staging`.
4. Copy `staging.env.example` to `staging.env` and replace every placeholder.
5. From this directory run:

   `docker compose --env-file staging.env -f compose.yml up -d --build`

6. Check the stack with:

   `docker compose --env-file staging.env -f compose.yml ps`

## Updates

Replace the application source, then rerun the same `up -d --build` command.
The migration service applies committed Prisma migrations before API and worker
start. Named volumes preserve PostgreSQL, Redis, MinIO, and TLS state.

## Security boundary

- Do not reuse production secrets or production customer data.
- Do not expose PostgreSQL, Redis, MinIO, API, or web ports on the host.
- Allow SSH, HTTP, and HTTPS only in the cloud firewall.
- Keep `staging.env` readable only by the server administrator.
