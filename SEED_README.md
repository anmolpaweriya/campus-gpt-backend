# Seed scripts

This project uses **Supabase Auth** for login. These scripts reset PostgreSQL and seed **Supabase users** for both frontend roles (**ADMIN** and **USER**).

## Prerequisites

1. Ensure PostgreSQL database is accessible (only for `seed:db`)
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `backend/.env.local` (Supabase Dashboard → Settings → API → `service_role` key)

## User Credentials

Supabase seeding uses the following environment variables from `backend/.env.local`:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `USER_EMAIL`
- `USER_PASSWORD`

## Usage

Run **only Supabase user seeding** (this is what fixes “user not created in Supabase”):

```bash
cd backend
npm run seed:supabase
```

Run **only DB reset**:

```bash
cd backend
npm run seed:db
```

Run **both**:

```bash
cd backend
npm run seed
```

## What it does

1. **Resets PostgreSQL Database**:
   - Drops all existing tables
   - Recreates the database schema with all models

2. **Seeds Supabase Users**:
   - Creates an ADMIN user (`user_metadata.role = "ADMIN"`)
   - Creates a USER user (`user_metadata.role = "USER"`)
   - If users already exist, they are deleted and recreated

## Notes

- **You cannot create users with the anon key.** Supabase user creation requires `SUPABASE_SERVICE_ROLE_KEY`.
- If PostgreSQL isn’t reachable from your current machine/network, `seed:db` will fail — but you can still run `seed:supabase`.
