import { useState } from 'react';
import { useDesafios } from '../hooks/useDesafios';
import { CheckCircle, XCircle, Clock, MapPin, Users } from 'lucide-react';

const DIAS  = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatearFecha(iso: string): string {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? new Date().getFullYear();
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

function formatearHora(time: string): string {
  return time.slice(0, 5);
}

interface DesafioCardProps {
  desafio: any;
  soyElDestino: boolean;
  onAceptar: () => Promise<void>;
  onRechazar: () => Promise<void>;
  isLoading: boolean;
}

function DesafioCard({ desafio, soyElDestino, onAceptar, onRechazar, isLoading }: DesafioCardProps) {
  const [confirmando, setConfirmando] = useState(false);

  if (confirmando) {
    return (
      <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-4">
        <p className="mb-3 font-bold text-blue-900">¿Aceptás el desafio?</p>

        <div className="mb-4 space-y-2 rounded-lg bg-white p-3 text-sm">
          <p><strong>Quién:</strong> {desafio.nombre_de}</p>
          <p><strong>Cuándo:</strong> {formatearFecha(desafio.fecha)} a las {formatearHora(desafio.hora_inicio)}</p>
          <p><strong>Dónde:</strong> {desafio.club_nombre} - {desafio.cancha_nombre}</p>
          <p><strong>Duración:</strong> {desafio.duracion_min} minutos</p>
          {desafio.mensaje && (
            <p><strong>Mensaje:</strong> {desafio.mensaje}</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={async () => {
              await onAceptar();
              setConfirmando(false);
            }}
            disabled={isLoading}
            className="flex-1 rounded-xl bg-green-500 px-3 py-2 font-bold text-white hover:bg-green-600 disabled:opacity-60"
          >
            {isLoading ? 'Aceptando...' : '✓ Aceptar'}
          </button>
          <button
            onClick={() => setConfirmando(false)}
            disabled={isLoading}
            className="flex-1 rounded-xl border-2 border-gray-300 px-3 py-2 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  const esAntiguoDesafio = new Date(desafio.fecha + 'T' + desafio.hora_inicio) < new Date();
  const puedeActuar = soyElDestino && desafio.estado === 'pendiente' && !esAntiguoDesafio;

  return (
    <div className={`rounded-2xl border-2 p-4 ${
      desafio.estado === 'pendiente' ? 'border-yellow-300 bg-yellow-50' :
      desafio.estado === 'aceptado' ? 'border-green-300 bg-green-50' :
      desafio.estado === 'rechazado' ? 'border-red-300 bg-red-50' :
      'border-gray-300 bg-gray-50'
    }`}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-bold text-gray-900">
            {desafio.soyElProponente ? '📤 Propusiste' : '📥 Te desafiaron'}
          </p>
          <p className="text-sm text-gray-600">
            {desafio.soyElProponente ? desafio.nombre_para : desafio.nombre_de}
          </p>
        </div>

        {/* Badge de estado */}
        <div className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${
          desafio.estado === 'pendiente' ? 'bg-yellow-200 text-yellow-900' :
          desafio.estado === 'aceptado' ? 'bg-green-200 text-green-900' :
          desafio.estado === 'rechazado' ? 'bg-red-200 text-red-900' :
          'bg-gray-200 text-gray-900'
        }`}>
          {desafio.estado === 'pendiente' && <Clock className="h-3 w-3" />}
          {desafio.estado === 'aceptado' && <CheckCircle className="h-3 w-3" />}
          {desafio.estado === 'rechazado' && <XCircle className="h-3 w-3" />}
          {desafio.estado === 'jugado' && <CheckCircle className="h-3 w-3" />}
          {desafio.estado.charAt(0).toUpperCase() + desafio.estado.slice(1)}
        </div>
      </div>

      {/* Detalles */}
      <div className="mb-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-700">
          <Clock className="h-4 w-4" />
          {formatearFecha(desafio.fecha)} · {formatearHora(desafio.hora_inicio)}
          <span className="text-xs text-gray-500">({desafio.duracion_min} min)</span>
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <MapPin className="h-4 w-4" />
          {desafio.club_nombre}
        </div>
        <div className="flex items-center gap-2 text-gray-700">
          <Users className="h-4 w-4" />
          {desafio.cancha_nombre}
        </div>
      </div>

      {desafio.mensaje && (
        <div className="mb-3 rounded-lg bg-white/70 p-2 text-xs italic text-gray-700">
          "{desafio.mensaje}"
        </div>
      )}

      {/* Acciones */}
      {puedeActuar ? (
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmando(true)}
            disabled={isLoading}
            className="flex-1 rounded-lg bg-green-500 py-2 font-bold text-white hover:bg-green-600 disabled:opacity-60"
          >
            ✓ Aceptar
          </button>
          <button
            onClick={onRechazar}
            disabled={isLoading}
            className="flex-1 rounded-lg border-2 border-red-300 py-2 font-bold text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            ✗ Rechazar
          </button>
        </div>
      ) : desafio.estado === 'aceptado' && desafio.reserva_id_de && desafio.reserva_id_para ? (
        <div className="rounded-lg bg-green-100 px-3 py-2 text-center text-xs font-bold text-green-900">
          ✓ Reservas creadas automáticamente
        </div>
      ) : esAntiguoDesafio && desafio.estado === 'pendiente' ? (
        <div className="rounded-lg bg-gray-100 px-3 py-2 text-center text-xs font-bold text-gray-600">
          Desafio expirado
        </div>
      ) : null}
    </div>
  );
}

export function DesafiosPanel() {
  const { desafios, isLoading, aceptarDesafio, rechazarDesafio, error } = useDesafios();
  const [procesando, setProcesando] = useState<number | null>(null);

  const pendientes = desafios.filter(d => d.estado === 'pendiente' && !d.soyElProponente);
  const activos = desafios.filter(d => d.estado === 'aceptado');
  const otros = desafios.filter(d => d.estado !== 'pendiente' || d.soyElProponente);

  const handleAceptar = async (desafioId: number) => {
    setProcesando(desafioId);
    try {
      await aceptarDesafio(desafioId);
    } finally {
      setProcesando(null);
    }
  };

  const handleRechazar = async (desafioId: number) => {
    setProcesando(desafioId);
    try {
      await rechazarDesafio(desafioId);
    } finally {
      setProcesando(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-200" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
          {error}
        </div>
      )}

      {/* Pendientes de responder */}
      {pendientes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-yellow-700">
            🎯 Desafios pendientes ({pendientes.length})
          </h3>
          {pendientes.map(d => (
            <DesafioCard
              key={d.id}
              desafio={d}
              soyElDestino={!d.soyElProponente}
              onAceptar={async () => await handleAceptar(d.id)}
              onRechazar={async () => await handleRechazar(d.id)}
              isLoading={procesando === d.id}
            />
          ))}
        </div>
      )}

      {/* Aceptados (confirmados) */}
      {activos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-green-700">
            ✓ Confirmados ({activos.length})
          </h3>
          {activos.map(d => (
            <DesafioCard
              key={d.id}
              desafio={d}
              soyElDestino={!d.soyElProponente}
              onAceptar={async () => {}}
              onRechazar={async () => {}}
              isLoading={false}
            />
          ))}
        </div>
      )}

      {/* Otros (rechazados, jugados, etc) */}
      {otros.length > 0 && otros.some(d => d.estado !== 'pendiente') && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-600">
            📋 Historial
          </h3>
          {otros
            .filter(d => d.estado !== 'pendiente')
            .map(d => (
              <DesafioCard
                key={d.id}
                desafio={d}
                soyElDestino={!d.soyElProponente}
                onAceptar={async () => {}}
                onRechazar={async () => {}}
                isLoading={false}
              />
            ))}
        </div>
      )}

      {desafios.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 py-8 text-center">
          <p className="text-sm text-gray-500">
            Aún no hay desafios. ¡Desafia a un amigo! 🎾
          </p>
        </div>
      )}
    </div>
  );
}
