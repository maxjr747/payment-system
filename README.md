# Complete Payment System

This project provides a simple customer payment page and a Node.js backend.

## Flow
1. Customer opens your page
2. Enters amount
3. Server calls `handOrder`
4. Server polls `queryPage`
5. Server extracts `records[0].cashierUrl` (or matching record)
6. Customer is redirected automatically

## Important
Use this only with a payment backend you own or are authorized to integrate with.
Keep your provider auth token on the server only.

## Setup
1. Copy `.env.example` to `.env`
2. Fill in `PROVIDER_AUTH_TOKEN`
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`

## Health Check
Visit:

```bash
http://localhost:3000/api/health
```

## Notes
- Amounts are converted to minor units. Example: `19.99` becomes `1999`.
- The server matches the newest order by amount and `cashierUrl`.
- If multiple orders with the same amount are created at the same time, you may want to add a stronger matching key later.
