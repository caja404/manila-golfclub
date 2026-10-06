import { useEffect, useRef, useState } from 'react';
import { canUseLiveCamera, fileToPhoto, videoToPhoto } from '../lib/photo.ts';

/**
 * Take a photo as proof of a bag's condition. Tablets and phones open their camera app;
 * a computer opens a live camera view in the page, with a file upload as the fallback.
 */
export function PhotoCapture({
  id,
  value,
  onChange,
  label = 'Photo',
}: {
  id: string;
  value: string | null;
  onChange: (photo: string | null) => void;
  label?: string;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches;

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onChange(await fileToPhoto(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const take = () => {
    setError(null);
    if (canUseLiveCamera()) setLive(true);
    else cameraInput.current?.click();
  };

  return (
    <div className="photo-field">
      <span className="label">{label}</span>
      {live ? (
        <LiveCamera
          onCapture={(photo) => {
            onChange(photo);
            setLive(false);
          }}
          onCancel={() => setLive(false)}
          onUnavailable={(msg) => {
            setLive(false);
            setError(msg);
            cameraInput.current?.click();
          }}
        />
      ) : value ? (
        <div className="photo-taken">
          <img src={value} alt="Photo of the bag" />
          <div className="photo-actions">
            <button type="button" className="btn btn-small" onClick={take}>
              Retake
            </button>
            <button type="button" className="btn btn-small btn-text" onClick={() => onChange(null)}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="photo-actions">
          <button type="button" className="btn" onClick={take}>
            Take photo
          </button>
          {desktop && (
            <button type="button" className="btn btn-text" onClick={() => fileInput.current?.click()}>
              Upload a photo
            </button>
          )}
        </div>
      )}
      {error && <p className="photo-error small">{error}</p>}
      <input
        ref={cameraInput}
        id={`${id}-camera`}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          fromFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        id={`${id}-file`}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          fromFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function LiveCamera({
  onCapture,
  onCancel,
  onUnavailable,
}: {
  onCapture: (photo: string) => void;
  onCancel: () => void;
  onUnavailable: (message: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => onUnavailable('The camera could not be opened here. Choose a photo instead.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera">
      <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} />
      <div className="photo-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => video.current && onCapture(videoToPhoto(video.current))}>
          Capture
        </button>
        <button type="button" className="btn btn-text" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
