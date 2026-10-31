import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const optionalEmail = z.union([z.string().email(), z.literal('')]).optional();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_BASE_URL: z.string().url().default(process.env['PAYPAL_API_BASE'] ?? 'https://api-m.sandbox.paypal.com'),
  PAYPAL_API_BASE: z.string().url().default(process.env['PAYPAL_BASE_URL'] ?? 'https://api-m.sandbox.paypal.com'),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_SANDBOX_MERCHANT_EMAIL: optionalEmail,
  PAYPAL_SANDBOX_MERCHANT_RECIPIENT_EMAIL: optionalEmail,
  PAYPAL_SANDBOX_VEGETABLE_VENDOR_EMAIL: optionalEmail,
  PAYPAL_SANDBOX_MILK_VENDOR_EMAIL: optionalEmail,
  PAYPAL_SANDBOX_CAB_DRIVER_EMAIL: optionalEmail,
  PAYPAL_SANDBOX_RECEIVER_EMAIL: optionalEmail,
  FAMILY_DASHBOARD_EMAIL: optionalEmail,
  FAMILY_DASHBOARD_PASSWORD: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  // Keep this configured model aligned with Groq's active model catalog.
  GROQ_MODEL: z.string().optional(),
  LLM_DEMO_CACHE: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().url(),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
