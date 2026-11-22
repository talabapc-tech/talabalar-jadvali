import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ebzzfbifmorqqtdfvenz.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVienpmYmlmbW9ycXF0ZGZ2ZW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDY5MTEsImV4cCI6MjEwNjQyMjkxMX0.Z6VTFMK0B5B2jOZx6BVqYGOkDGxCb3xciRVyTKCjjGQ'

/** Brauzer va server uchun universal Supabase mijozi */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
