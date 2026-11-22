import 'server-only'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ebzzfbifmorqqtdfvenz.supabase.co'

/** Faqat server uchun service_role huquqiga ega mijoz */
export function getServiceSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY muhit o'zgaruvchisi sozlanmagan")
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })
}
