/**
 * usePlayerProfile — perfil del jugador B2C, persistido en Supabase.
 *
 * Lee/escribe en jugadores_app, optimizado con React Query para cacheo y baja latencia.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

    if (error) { 
      console.error('[profile] avatar upload:', error.message); 
      return null; 
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    return `${publicUrl}?t=${Date.now()}`;
  } catch (err) {
    console.error('[profile] avatar upload failed:', err);
    return null;
  }
}

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
  const queryClient = useQueryClient();

  // Cargar perfil con React Query (Caché por 15 minutos, refresco en background)
  const { data: profile = DEFAULT, isLoading, refetch } = useQuery<PlayerProfile>({
    queryKey: ['player-profile'],
    queryFn: async (): Promise<PlayerProfile> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return DEFAULT;

      // Consulta completa
      const { data: full, error: e1 } = await supabase
        .from('jugadores_app')
        .select('nombre_display, alias, telefono, genero, categoria, foto_url')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      let row: JugadorRow | null = null;

      if (e1) {
        // Fallback a columnas base (0075) si falla
        const { data: base } = await supabase
          .from('jugadores_app')
          .select('nombre_display, foto_url')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        row = base as JugadorRow | null;
      } else {
        row = full as JugadorRow | null;
      }

      if (!row) return { ...DEFAULT, email: user.email ?? '' };

      return {
        nombre:     row.nombre_display            ?? '',
        alias:      row.alias                     ?? '',
        telefono:   row.telefono                  ?? '',
        email:      user.email                     ?? '',
        categoria:  (row.categoria as Categoria)  ?? '',
        genero:     (row.genero    as Genero)     ?? '',
        avatar_url: row.foto_url                  ?? null,
      };
    },
    staleTime: 1000 * 60 * 15, // Considerar datos frescos por 15 minutos
    gcTime: 1000 * 60 * 30,    // Mantener en memoria inactiva por 30 minutos
  });

  // Mutación para guardar perfil
  const mutation = useMutation<PlayerProfile, Error, PlayerProfile>({
    mutationFn: async (updates: PlayerProfile): Promise<PlayerProfile> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sin sesión activa');

      // Sube el avatar si es un data-URI nuevo
      const resolvedAvatar = updates.avatar_url?.startsWith('data:')
        ? await resolveAvatarUrl(user.id, updates.avatar_url)
        : updates.avatar_url;

      const nombreCorto = updates.nombre.trim().split(' ')[0] ?? updates.nombre.trim();

      // Upsert completo
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
          // Fallback a columnas base (0075)
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

      return { ...updates, avatar_url: resolvedAvatar };
    },
    onSuccess: (updatedProfile) => {
      // Actualizar caché de React Query inmediatamente
      queryClient.setQueryData(['player-profile'], updatedProfile);
    },
  });

  const saveProfile = useCallback(async (updates: PlayerProfile): Promise<void> => {
    await mutation.mutateAsync(updates);
  }, [mutation]);

  /** Iniciales para el avatar fallback */
  const iniciales = (profile.alias || profile.nombre)
    .trim()
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  return { 
    profile, 
    saveProfile, 
    isSaving: mutation.isPending, 
    isLoading, 
    iniciales,
    refetch 
  };
}
