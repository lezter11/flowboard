import type { z } from 'zod';

export * from './common.ts';
export * from './auth.ts';
export * from './workspaces.ts';
export * from './projects.ts';
export * from './invitations.ts';
export * from './cards.ts';
export * from './boards.ts';
export * from './discussion.ts';
export * from './activity-actions.ts';
export * from './images.ts';
export * from './trash.ts';
export * from './imports.ts';

export interface FormattedZodIssue {
  path: string;
  message: string;
  code: string;
}

export function formatZodError(error: z.ZodError): FormattedZodIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

export class ValidationError extends Error {
  readonly issues: FormattedZodIssue[];

  constructor(issues: FormattedZodIssue[]) {
    super(`Validation failed: ${issues.map((f) => `${f.path || '(root)'}: ${f.message}`).join('; ')}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
}

export function safeParse<T>(schema: z.ZodType<T>, data: unknown): z.ZodSafeParseResult<T> {
  return schema.safeParse(data);
}
