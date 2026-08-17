// Throwaway: find far-flung coords feeding kofi's home coverage map.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const { data: kofi } = await admin.from('users').select('id').eq('username', 'kofi').single();
const since = new Date(Date.now() - 30 * 86400_000).toISOString();

const { data: knocks } = await admin
  .from('visits')
  .select('lat, lng, visited_at, visit_type')
  .eq('rep_id', kofi.id)
  .gte('visited_at', since)
  .limit(2000);
const pts = (knocks ?? []).filter((k) => k.lat != null && k.lng != null);
console.log('kofi 30d visits:', knocks?.length, 'with coords:', pts.length);
const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
console.log('lat range', Math.min(...lats), '→', Math.max(...lats));
console.log('lng range', Math.min(...lngs), '→', Math.max(...lngs));
const odd = pts.filter((p) => Math.abs(p.lat - 5.35) > 0.5 || Math.abs(p.lng + 4) > 0.5);
console.log('outliers (>0.5° from Abidjan):', JSON.stringify(odd.slice(0, 10), null, 1));

// Installations layer (rep sees ALL) — coords come from contacts.
const { data: inst } = await admin
  .from('installations')
  .select('status, contacts(name, lat, lng)')
  .limit(500);
const ipts = (inst ?? []).filter((i) => i.contacts?.lat != null && i.contacts?.lng != null);
console.log('\ninstalls with coords:', ipts.length, '/', inst?.length);
const ioddm = ipts.filter((i) => Math.abs(i.contacts.lat - 5.35) > 0.5 || Math.abs(i.contacts.lng + 4) > 0.5);
console.log('install outliers:', JSON.stringify(ioddm, null, 1));
