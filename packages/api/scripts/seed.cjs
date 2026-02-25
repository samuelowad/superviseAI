#!/usr/bin/env node

const bcrypt = require('bcrypt');
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://supervise:supervise@localhost:5433/superviseai';
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD || 'SuperviseAI123!';

const SEED_USERS = [
  {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@superviseai.local',
    fullName: 'Platform Admin',
    role: 'admin',
    isVerified: true,
  },
  {
    email: process.env.SEED_PROFESSOR_EMAIL || 'professor@superviseai.local',
    fullName: 'Dr. Sarah Mensah',
    role: 'professor',
    isVerified: true,
  },
  {
    email: process.env.SEED_STUDENT_EMAIL || 'student@superviseai.local',
    fullName: 'Alex Johnson',
    role: 'student',
    isVerified: true,
  },
];

async function ensureTables(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      full_name text NOT NULL,
      role text NOT NULL CHECK (role IN ('student', 'professor', 'admin')),
      is_active boolean NOT NULL DEFAULT true,
      is_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function seedUsers(client) {
  const passwordHash = await bcrypt.hash(SEED_USER_PASSWORD, 10);

  const rows = [];

  for (const user of SEED_USERS) {
    const result = await client.query(
      `
        INSERT INTO users (email, password_hash, full_name, role, is_active, is_verified)
        VALUES ($1, $2, $3, $4, true, $5)
        ON CONFLICT (email)
        DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active,
          is_verified = EXCLUDED.is_verified
        RETURNING id, email, role, is_active, is_verified;
      `,
      [user.email, passwordHash, user.fullName, user.role, user.isVerified],
    );

    rows.push(result.rows[0]);
  }

  return rows;
}

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    await client.query('BEGIN');

    await ensureTables(client);
    const seededUsers = await seedUsers(client);

    await client.query('COMMIT');

    console.log('Seed completed successfully.');
    console.table(seededUsers);
    console.log('Default seed password:', SEED_USER_PASSWORD);
    console.log('Tip: Set SEED_USER_PASSWORD in your environment before running the seed script.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback errors when the connection is already terminated.
      console.error('Rollback skipped:', rollbackError.message);
    }
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch (closeError) {
      console.error('Client close warning:', closeError.message);
    }
  }
}

run();
