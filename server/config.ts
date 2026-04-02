export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA', // Dummy key for testing
  isProduction: process.env.NODE_ENV === 'production',
  maxPayloadSize: 256 * 1024, // 256kb
  rateLimitMax: 100, // 100 requests per hour
  rateLimitTimeWindow: 60 * 60 * 1000, // 1 hour
  reservationTtl: parseInt(process.env.RESERVATION_TTL_SECONDS || '60', 10)
};
