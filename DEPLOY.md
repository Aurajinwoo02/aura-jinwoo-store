# AURA JINWOO STORE — V4 deployment

## What is ready
- Same-origin customer login/register and server-side sessions.
- Admin account controlled by `ADMIN_EMAIL` + `ADMIN_PASSWORD`.
- SQLite database with persistent path support (`DB_PATH`).
- Products, stock, carts/orders and UTR/manual payment verification.
- Cancelling an order automatically returns its reserved stock.
- `/health` endpoint for hosting health checks.
- Docker + Render blueprint included.

## Render deployment
1. Create a GitHub repository and upload this folder.
2. In Render, create a Blueprint from the repository and use `render.yaml`.
3. Set the secret environment variables when prompted:
   - `ADMIN_PASSWORD`: your private strong password (12+ characters recommended).
   - `STORE_UPI_ID`: your merchant UPI ID.
4. Keep the persistent disk mounted at `/var/data`; this is where `store.db` is stored.
5. Deploy. Render will provide the public `onrender.com` URL.

## Local deployment
```bash
npm install
# create .env from .env.example and set secrets
npm start
```

## Payment
The included QR + UTR flow is manual verification. Automatic confirmation requires a payment gateway/merchant API and server-side webhook verification.

## Security
Never commit `.env`, the admin password, JWT secret, or `store.db` to a public repository. Use HTTPS in production.
