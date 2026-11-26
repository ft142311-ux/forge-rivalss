/**
 * @fileOverview Структурированный логгер для серверной части v2.0.
 * Использует console.log для совместимости с потоками ответов Next.js.
 */

export const logger = {
  info: (message: string, context?: any) => {
    console.log(JSON.stringify({ 
      level: 'info', 
      message, 
      ...context, 
      timestamp: new Date().toISOString() 
    }));
  },
  warn: (message: string, context?: any) => {
    console.warn(JSON.stringify({ 
      level: 'warn', 
      message, 
      ...context, 
      timestamp: new Date().toISOString() 
    }));
  },
  error: (message: string, error?: any, context?: any) => {
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      error: error?.message || error, 
      stack: error?.stack,
      ...context, 
      timestamp: new Date().toISOString() 
    }));
  }
};
