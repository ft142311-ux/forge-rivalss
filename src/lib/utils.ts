import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Форматирует числовое значение валюты в сокращенный вид (k, M, B).
 * Добавлена защита от NaN и некорректных типов данных.
 */
export function formatCurrency(val: any): string {
  const numericVal = Number(val);
  
  if (isNaN(numericVal)) {
    return '0';
  }

  if (numericVal >= 1000000000) {
    return (numericVal / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (numericVal >= 1000000) {
    return (numericVal / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (numericVal >= 1000) {
    return (numericVal / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return Math.floor(numericVal).toString();
}
