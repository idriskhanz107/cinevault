import type { Genre, Movie } from './types';

/**
 * Sample catalogue used ONLY when VITE_DEMO_MODE=true. All titles are fictional.
 * Demo movies have no video; the UI labels them clearly as demo content.
 */
const base = (i: number, m: Partial<Movie> & Pick<Movie, 'title' | 'genres' | 'release_year'>): Movie => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  description: 'Sample description for demo mode. Connect Supabase to load real catalogue data.',
  release_date: null,
  language: 'English',
  country: 'Demo',
  director: 'Demo Director',
  cast: ['Demo Actor', 'Sample Performer'],
  duration_minutes: 100 + i * 4,
  poster_url: null,
  backdrop_url: null,
  trailer_url: null,
  video_provider: 'cloudflare_stream',
  video_asset_id: null,
  visibility: 'published',
  upload_status: 'ready',
  tmdb_id: null,
  popularity: 100 - i * 7,
  rating_avg: Number((3.2 + (i % 5) * 0.35).toFixed(2)),
  rating_count: 10 + i,
  created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
  updated_at: new Date().toISOString(),
  created_by: null,
  ...m,
});

export const DEMO_MOVIES: Movie[] = [
  base(1, { title: 'Midnight Meridian', genres: ['Thriller', 'Mystery'], release_year: 2023, description: 'A night-shift cartographer finds a map that redraws itself.' }),
  base(2, { title: 'The Glass Orchard', genres: ['Drama'], release_year: 2021, description: 'Three generations argue over the family farm and its secrets.' }),
  base(3, { title: 'Starlight Courier', genres: ['Science Fiction', 'Adventure'], release_year: 2024, description: 'A freight pilot carries an impossible parcel across the outer belt.' }),
  base(4, { title: 'Paper Lanterns', genres: ['Romance', 'Drama'], release_year: 2019 }),
  base(5, { title: 'Iron Harbour', genres: ['Action', 'Crime'], release_year: 2022 }),
  base(6, { title: 'Quiet Thunder', genres: ['Documentary'], release_year: 2020 }),
  base(7, { title: 'The Last Lighthouse', genres: ['Mystery', 'Thriller'], release_year: 2018 }),
  base(8, { title: 'Sunday Circus', genres: ['Comedy', 'Family'], release_year: 2024 }),
  base(9, { title: 'Echoes of Ember', genres: ['Fantasy', 'Adventure'], release_year: 2017 }),
  base(10, { title: 'Neon Alley', genres: ['Crime', 'Action'], release_year: 2025 }),
];

export const DEMO_GENRES: Genre[] = [
  'Action', 'Adventure', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy',
  'Mystery', 'Romance', 'Science Fiction', 'Thriller',
].map((name, i) => ({ id: i + 1, name, slug: name.toLowerCase().replace(/\s+/g, '-') }));
