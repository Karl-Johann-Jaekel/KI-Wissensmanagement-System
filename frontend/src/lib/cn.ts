import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Klassen zusammenführen: clsx für Bedingungen, twMerge löst Tailwind-Konflikte. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
