/**
 * Supabase database type definitions.
 * Generated shape – will be replaced with `supabase gen types typescript` output
 * once the schema is deployed.
 *
 * A5 — USAGE STATUS:
 *   Actively queried:   locations, astro_events
 *   Future (not wired): weather_cache, sunmoon_cache, clima_stat,
 *                       observations, user_preferences
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      locations: {
        Row: {
          id: string
          user_id: string | null
          name: string
          description: string | null
          latitude: number
          longitude: number
          elevation_m: number
          bortle_class: number
          horizon_profile: Json | null
          is_public: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['locations']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['locations']['Insert']>
        Relationships: []
      }
      weather_cache: {
        Row: {
          id: string
          location_id: string
          forecast_time: string
          fetched_at: string
          cloud_cover_pct: number
          precipitation_mm: number
          wind_speed_ms: number
          temperature_c: number
          humidity_pct: number
          seeing_score: number | null
          weather_score: number
        }
        Insert: Omit<Database['public']['Tables']['weather_cache']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['weather_cache']['Insert']>
        Relationships: []
      }
      sunmoon_cache: {
        Row: {
          id: string
          location_id: string
          forecast_time: string
          computed_at: string
          sun_azimuth: number
          sun_elevation: number
          sun_twilight_type: string
          moon_azimuth: number
          moon_elevation: number
          moon_illumination_pct: number
          moon_phase_pct: number
          darkness_score: number
        }
        Insert: Omit<Database['public']['Tables']['sunmoon_cache']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['sunmoon_cache']['Insert']>
        Relationships: []
      }
      clima_stat: {
        Row: {
          id: string
          location_id: string
          day_of_year: number
          hour_of_day: number
          cloud_cover_avg: number
          clear_sky_probability: number
          precipitation_prob: number
          wind_speed_avg_ms: number
          clima_score: number
          sample_count: number
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['clima_stat']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['clima_stat']['Insert']>
        Relationships: []
      }
      observations: {
        Row: {
          id: string
          user_id: string
          location_id: string
          observed_at: string
          actual_sqm: number | null
          notes: string | null
          image_path: string | null
          weather_score_actual: number | null
          darkness_score_actual: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['observations']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['observations']['Insert']>
        Relationships: []
      }
      user_preferences: {
        Row: {
          id: string
          user_id: string
          home_latitude: number | null
          home_longitude: number | null
          max_distance_km: number
          min_weather_score: number
          min_darkness_score: number
          preferred_bortle_max: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['user_preferences']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['user_preferences']['Insert']>
        Relationships: []
      }
      astro_events: {
        Row: {
          id: string
          event_type: string
          event_date: string
          label: string
          kind: string | null
          max_duration_sec: number | null
          metadata: Json | null
          path_geometry: Json | null
          centerline_geometry: Json | null
          details: Json | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['astro_events']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['astro_events']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
