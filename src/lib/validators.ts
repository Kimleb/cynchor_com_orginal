import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: 'Username must be at least 3 characters' })
  .max(20, { message: 'Username must be at most 20 characters' })
  .regex(/^[a-z0-9_-]+$/, {
    message: 'Username may only contain lowercase letters, numbers, hyphens, and underscores',
  });

export const loginSchema = z.object({
  username: usernameSchema,
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .max(128, { message: 'Password exceeds maximum length' }),
});

export const accessRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .max(200, { message: 'Note must be at most 200 characters' })
    .optional()
    .default(''),
  source: z.enum(['demo', 'pilot']).default('demo').optional(),
  website: z.string().max(0, { message: 'Bot detected' }).optional(),
});

export const inviteTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8, { message: 'Claim token must be at least 8 characters' })
    .max(128, { message: 'Claim token exceeds maximum length' })
    .regex(/^[a-zA-Z0-9\-_]+$/, { message: 'Claim token contains invalid characters' }),
});

export const claimAccountSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8, { message: 'Claim token must be at least 8 characters' })
    .max(128, { message: 'Claim token exceeds maximum length' })
    .regex(/^[a-zA-Z0-9\-_]+$/, { message: 'Claim token contains invalid characters' }),
  username: usernameSchema.optional(),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .max(128, { message: 'Password exceeds maximum length' }),
});

export const teamCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, { message: 'Team name must be at least 3 characters' })
    .max(64, { message: 'Team name exceeds maximum length' })
    .regex(/^[a-zA-Z0-9\s\-_]+$/, { message: 'Team name may only contain alphanumeric characters, spaces, and hyphens' }),
  side: z.enum(['RED', 'BLUE'], {
    message: 'Side must be either RED or BLUE',
  }),
});

export const disclaimerSchema = z.object({
  accepted: z.literal(true, {
    message: 'You must accept the simulation terms',
  }),
  user_identifier: z.string().trim().min(1).max(255),
  version: z.string().trim().default('v1.2'),
});

/**
 * Output HTML sanitization helper to prevent XSS in rendered synthetic logs or inputs
 */
export function sanitizeOutput(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
