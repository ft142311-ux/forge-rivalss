import data from './placeholder-images.json';
import type { ImagePlaceholder } from '@/lib/placeholder-image-types';

export type { ImagePlaceholder } from '@/lib/placeholder-image-types';

/**
 * Exported placeholder images array.
 * Includes a fallback to an empty array to prevent runtime crashes if JSON is missing or malformed.
 */
export const PlaceHolderImages: ImagePlaceholder[] = data?.placeholderImages || [];
