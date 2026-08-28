const requiredEnvironmentVariables = [
  'DB_URL',
  'JWT_SECRET',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_DOMAIN',
  'ALLOWED_ORIGINS',
] as const;

/** Fails before Express accepts requests when deployment configuration is incomplete. */
export const validateEnvironment = (): void => {
  const missing = requiredEnvironmentVariables.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  }
};
