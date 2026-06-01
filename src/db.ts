import "@/load-env.js";

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const isProduction = process.env.NODE_ENV === "production";

export const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

export async function connectDb(): Promise<void> {
  const client = await db.connect();
  client.release();
  console.log("✅ Connected to PostgreSQL");
}
