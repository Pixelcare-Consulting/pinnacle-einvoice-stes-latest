# Pinnacle eInvoice

A specialized middleware solution designed to integrate business applications with LHDN's (Lembaga Hasil Dalam Negeri) e-Invoicing system. This middleware facilitates seamless invoice data exchange while ensuring compliance with Malaysian tax regulations.

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/Pixelcare-Consulting/pinnacle-eInvoice.git
   ```

2. Install dependencies:
   ```
   pnpm install
   ```

## Running the Application

### Development Mode

#### Using Nodemon (Not Recommended for LHDN Submissions)

```
pnpm run dev
```

#### Using PM2 (Recommended for Stability)

```
pnpm run pm2
```

Or use the provided batch file:

```
start-dev-with-pm2.bat
```

### Production Mode

```
pnpm run pm2
```

Or use the provided batch file:

```
start-with-pm2.bat
```

## LHDN Submission Process

When submitting documents to LHDN, it's recommended to use PM2 instead of nodemon to avoid server restarts during the submission process. PM2 provides better stability and will not restart the server when files are modified.

### Troubleshooting LHDN Submissions

If you encounter issues with LHDN submissions:

1. Check if the document was actually submitted by looking at the document status in the table.
2. If the frontend shows an error but the backend shows a successful submission, the document was likely submitted successfully but the server restarted during the process.
3. Use PM2 instead of nodemon to avoid server restarts during submissions.

## PM2 Commands

- Start the application: `pm2 start ecosystem.config.js`
- Stop the application: `pm2 stop eInvoice`
- Restart the application: `pm2 restart eInvoice`
- View logs: `pm2 logs eInvoice`
- Monitor the application: `pm2 monit`

## License

ISC
