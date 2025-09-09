# E3GoToConnect

This project is a web application for managing GoTo accounts, recordings, and transcriptions.

## Features

- User authentication (admin login)
- Dashboard to view connected accounts
- Add new GoTo accounts via OAuth
- View recordings and transcriptions for each account
- Fetch recordings on demand

## Setup

1. Clone the repository.
2. Install dependencies: `npm install`
3. Set up environment variables in a `.env` file (e.g., `GOTO_CLIENT_ID`, `GOTO_CLIENT_SECRET`, `GOTO_REDIRECT_URI`).
4. Start the server: `npm start`

## Usage

- Access the application at `http://localhost:3000`.
- Log in with admin credentials.
- Manage your GoTo accounts and recordings.