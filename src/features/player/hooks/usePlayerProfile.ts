/**
 * usePlayerProfile — perfil del jugador B2C, persistido en Supabase.
 *
 * Lee/escribe en jugadores_app. Resiliente a migración 0077 pendiente:
 * si las columnas alias/telefono/genero/categoria no existen aún, la
 * carga cae back a nombre_display + foto_url y el upsert guarda solo
 * los campos garantizados.
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export type Categoria =
  | '1ra' | '2da' | '3ra' | '4ta'
  | '5ta' | '6ta' | '7ta' | '8va'
  | 'libre';

export type Genero = 'masculino' | 'femenino' | 'no_especifica';

export interface PlayerProfile {
  nombre:     string;
  alias:      string;
  telefono:   string;
  email:      string;        // solo lectura — viene de auth.users
  categoria:  Categoria | '';
  genero:     Genero | '';
  avatar_url: string | null; // URL pública en el bucket 'avatars'
}

const DEFAULT: PlayerProfile = {
  nombre: '', alias: '', telefono: '', email: '',
  categoria: '', genero: '', avatar_url: null,
};

// ── Avatar upload ─────────────────────────────────────────────────────────────

async function resolveAvatarUrl(userId: string, dataUri: string): Promise<string | null> {
  try {
    const res  = await fetch(dataUri);
    const blob = await res.blob();
    const ext  = blob.type === 'image/png'  ? 'png'
               : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/avatar.${ext}`;

    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: blob.type });

    if (error) { console.error('[profile] avatar upload:', error.message); return null; }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    return `${publicUrl}?t=${Date.now()}`;
  } catch (err) {
    console.error('[profile] avatar upload failed:', err);
    return null;
  }
}

// ── Tipos internos para el row de DB ─────────────────────────────────────────

interface JugadorRow {
  nombre_display: string;
  foto_url:       string | null;
  alias?:         string | null;
  telefono?:      string | null;
  genero?:        string | null;
  categoria?:     string | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePlayerProfile() {
  const [profile,   setProfile]   = useState<PlayerProfile>(DEFAULT);
  const [isSaving,  setIsSaving]  = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // ── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Intenta query completa (requiere migración 0077)
        const { data: full, error: e1 } = await supabase
          .from('jugadores_app')
          .select('nombre_display, alias, telefono, genero, categoria, foto_url')
          .eq('auth_user_id', user.id)
          .maybeSingle();

        let row: JugadorRow | null = null;

        if (e1) {
          // Columnas nuevas no existen aún — fallback a columnas base (0075)
          console.warn('[profile] columnas extendidas no disponibles, usando base:', e1.message);
          const { data: base } = await supabase
            .from('jugadores_app')
            .select('nombre_display, foto_url')
            .eq('auth_user_id', user.id)
            .maybeSingle();
          row = base as JugadorRow | null;
        } else {
          row = full as JugadorRow | null;
        }

        if (!cancelled) {
          setProfile({
            nombre:     row?.nombre_display            ?? '',
            alias:      row?.alias                     ?? '',
            telefono:   row?.telefono                  ?? '',
            email:      user.email                     ?? '',
            categoria:  (row?.categoria as Categoria)  ?? '',
            genero:     (row?.genero    as Genero)     ?? '',
            avatar_url: row?.foto_url                  ?? null,
          });
        }
      } catch (err) {
        console.error('[profile] load error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Guardar ───────────────────────────────────────────────────────────────
  const saveProfile = useCallback(async (updates: PlayerProfile): Promise<void> => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sin sesión activa');

      // Sube el avatar si es un data-URI nuevo
      const resolvedAvatar = updates.avatar_url?.startsWith('data:')
        ? await resolveAvatarUrl(user.id, updates.avatar_url)
        : updates.avatar_url;

      const nombreCorto = updates.nombre.trim().split(' ')[0] ?? updates.nombre.trim();

      // Intenta upsert completo (requiere migración 0077)
      const { error: e1 } = await supabase.from('jugadores_app').upsert(
        {
          auth_user_id:   user.id,
          nombre_display: updates.nombre.trim(),
          nombre_corto:   nombreCorto,
          alias:          updates.alias.trim()    || null,
          telefono:       updates.telefono.trim() || null,
          genero:         updates.genero          || null,
          categoria:      updates.categoria       || null,
          foto_url:       resolvedAvatar,
        },
        { onConflict: 'auth_user_id' },
      );

      if (e1) {
        const isColumnMissing = e1.message.includes('column') || e1.message.includes('does not exist');
        if (isColumnMissing) {
          // Fallback: guardar solo columnas garantizadas (0075)
          console.warn('[profile] columnas extendidas no disponibles, guardando base:', e1.message);
          const { error: e2 } = await supabase.from('jugadores_app').upsert(
            {
              auth_user_id:   user.id,
              nombre_display: updates.nombre.trim(),
              nombre_corto:   nombreCorto,
              foto_url:       resolvedAvatar,
            },
            { onConflict: 'auth_user_id' },
          );
          if (e2) throw new Error(e2.message);
        } else {
          throw new Error(e1.message);
        }
      }

      setProfile({ ...updates, avatar_url: resolvedAvatar ?? null });
    } finally {
      setIsSaving(false);
    }
  }, []);

  /** Iniciales para el avatar fallback */
  const iniciales = (profile.alias || profile.nombre)
    .trim()
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  return { profile, saveProfile, isSaving, isLoading, iniciales };
}
