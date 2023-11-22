import { pino } from 'pino';

export const logger = pino();

logger.level = process.argv.includes('--verbose') ? 'trace' : 'info';
