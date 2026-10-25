import { z } from 'zod';

/** Upload constraints shared by the browser (UX) and the server (enforcement). */
export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
] as const;
export const ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mpeg', 'mpg', 'm4v'] as const;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_POSTER_BYTES = 5 * 1024 * 1024;

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https:\/\/[^\s]+$/i.test(v), 'Must be an https:// URL');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalUrl = httpsUrl
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Editorial fields an administrator may set on a movie. */
export const movieFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).default(''),
  release_year: z.number().int().min(1888).max(2100).nullable().optional(),
  release_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  genres: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  language: optionalText(60),
  country: optionalText(100),
  director: optionalText(200),
  cast: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
  poster_url: optionalUrl,
  backdrop_url: optionalUrl,
  trailer_url: optionalUrl,
  tmdb_id: z.number().int().positive().nullable().optional(),
  popularity: z.number().min(0).max(1_000_000).optional(),
});

export type MovieFields = z.infer<typeof movieFieldsSchema>;

export const createUploadSchema = z.object({
  movie: movieFieldsSchema,
  /** When present, the video of an existing movie is replaced. */
  movieId: z.uuid().optional(),
  file: z.object({
    name: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
    type: z.string().trim().max(100),
  }),
});

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}
