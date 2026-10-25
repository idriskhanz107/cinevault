export type Visibility = 'draft' | 'published';
export type UploadStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface Movie {
  id: string;
  title: string;
  description: string;
  release_year: number | null;
  release_date: string | null;
  genres: string[];
  language: string | null;
  country: string | null;
  director: string | null;
  cast: string[];
  duration_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  video_provider: string;
  video_asset_id: string | null;
  visibility: Visibility;
  upload_status: UploadStatus;
  tmdb_id: number | null;
  popularity: number;
  rating_avg: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface Genre {
  id: number;
  name: string;
  slug: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
}

export interface HistoryEntry {
  movie: Movie;
  position_seconds: number;
  duration_seconds: number | null;
  completed: boolean;
  last_watched_at: string;
}

export interface Review {
  id: string;
  movie_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  display_name: string;
}

export interface UploadRecord {
  id: string;
  movie_id: string | null;
  file_name: string;
  file_size_bytes: number;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  created_at: string;
}
