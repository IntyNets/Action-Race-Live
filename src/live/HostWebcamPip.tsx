import React, { useEffect, useRef, useState } from 'react';
import { WebcamRect, WebcamStatus } from './stageHealth';

interface HostWebcamPipProps {
  enabled: boolean;
  rect: WebcamRect;
  onRectChange?: (next: WebcamRect) => void;
  canEdit?: boolean;
  /** Chỉ xin quyền camera thật (getUserMedia) khi được cho phép — luôn mặc định tắt và audio: false */
  captureRealVideo?: boolean;
  onStatusChange?: (status: WebcamStatus) => void;
}

export const HostWebcamPip: React.FC<HostWebcamPipProps> = ({
  enabled,
  rect,
  onRectChange,
  canEdit = false,
  captureRealVideo = true,
  onStatusChange,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rectRef = useRef<WebcamRect>(rect);
  rectRef.current = rect;
  const [status, setStatus] = useState<WebcamStatus>('off');
  const [errMsg, setErrMsg] = useState<string>('');

  const updateStatus = (next: WebcamStatus) => {
    setStatus(next);
    onStatusChange?.(next);
  };

  useEffect(() => {
    let cancelled = false;

    const stopAllTracks = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try {
            t.onended = null;
            t.stop();
          } catch {}
        });
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    if (!enabled) {
      stopAllTracks();
      setErrMsg('');
      updateStatus('off');
      return;
    }

    if (!captureRealVideo) {
      updateStatus('active');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrMsg('Trình duyệt không hỗ trợ Webcam (cần HTTPS hoặc localhost)');
      updateStatus('denied');
      return;
    }

    updateStatus('starting');
    setErrMsg('');

    // Chỉ lấy hình ảnh (audio: false) để không xung đột Micro vật lý trong TikTok LIVE Studio
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const tracks = stream.getVideoTracks();
        tracks.forEach((track) => {
          track.onended = () => {
            if (!cancelled) {
              setErrMsg('Mất tín hiệu Camera');
              updateStatus('lost');
            }
          };
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        updateStatus('active');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrMsg(err?.name === 'NotAllowedError' ? 'Chưa cấp quyền Camera' : 'Không mở được Camera');
        updateStatus('denied');
      });

    return () => {
      cancelled = true;
      stopAllTracks();
    };
  }, [enabled, captureRealVideo]);

  if (!enabled) return null;

  const startInteract = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!canEdit || !onRectChange) return;
    const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null;
    if (!parent) return;
    e.preventDefault();
    e.stopPropagation();

    const pRect = parent.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = { ...rectRef.current };

    const onMove = (ev: PointerEvent) => {
      const dxPct = ((ev.clientX - startX) / Math.max(1, pRect.width)) * 100;
      const dyPct = ((ev.clientY - startY) / Math.max(1, pRect.height)) * 100;
      if (mode === 'move') {
        const nx = Math.max(1, Math.min(99 - init.w, init.x + dxPct));
        const ny = Math.max(6, Math.min(95 - init.h, init.y + dyPct));
        onRectChange({
          ...init,
          x: Math.round(nx * 10) / 10,
          y: Math.round(ny * 10) / 10,
        });
      } else {
        const nw = Math.max(16, Math.min(54, Math.min(99 - init.x, init.w + dxPct)));
        const nh =
          init.shape === 'circle'
            ? Math.max(10, Math.min(34, Math.round(nw * (9 / 16) * 10) / 10))
            : Math.max(10, Math.min(38, Math.min(95 - init.y, init.h + dyPct)));
        onRectChange({
          ...init,
          w: Math.round(nw * 10) / 10,
          h: Math.round(nh * 10) / 10,
        });
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const isCircle = rect.shape === 'circle';

  return (
    <div
      onPointerDown={(e) => startInteract(e, 'move')}
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
      }}
      className={`absolute z-30 select-none overflow-hidden bg-slate-950/90 border-2 ${
        status === 'active'
          ? 'border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.65)]'
          : 'border-amber-400/80 shadow-lg'
      } ${isCircle ? 'rounded-full' : 'rounded-2xl'} ${
        canEdit ? 'pointer-events-auto cursor-move' : 'pointer-events-none'
      }`}
    >
      {captureRealVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover scale-x-[-1]"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-center p-1">
          <span className="text-lg">📷</span>
          <span className="text-[8.5px] font-black text-rose-300 leading-tight">
            HOST CAM (STAGE)
          </span>
        </div>
      )}

      {/* Nhãn LIVE nhỏ */}
      <div
        className={`pointer-events-none absolute ${
          isCircle ? 'bottom-1 left-1/2 -translate-x-1/2' : 'top-1 left-1.5'
        } px-1.5 py-[1px] rounded-full bg-rose-600/90 text-white text-[7.5px] font-black flex items-center gap-1 shadow`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
        HOST
      </div>

      {/* Trạng thái lỗi nếu mất track hoặc bị từ chối quyền */}
      {errMsg && (
        <div className="pointer-events-none absolute inset-0 bg-slate-950/85 flex items-center justify-center p-1.5 text-center text-[8.5px] font-bold text-amber-300">
          {errMsg}
        </div>
      )}

      {/* Tay cầm thu phóng ở góc phải bên dưới (khi chỉnh trên Dashboard) */}
      {canEdit && (
        <div
          onPointerDown={(e) => startInteract(e, 'resize')}
          title="Kéo để thu phóng khung Webcam Host"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30 flex items-end justify-end p-0.5 bg-rose-500/85 rounded-tl-md border-t border-l border-white/60 hover:bg-amber-400"
        >
          <span className="text-[8px] leading-none text-white font-black">⤡</span>
        </div>
      )}
    </div>
  );
};
