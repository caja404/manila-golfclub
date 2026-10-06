// Photos are shrunk on the device before upload: a 12-megapixel phone photo (4-6 MB)
// becomes a ~1280px JPEG of about 150-300 KB, plenty to show a bag's condition.

const MAX_EDGE = 1280;
const QUALITY = 0.82;

function toJpeg(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

/** A photo from the device camera app or a file. Browsers apply the photo's own rotation when drawing. */
export function fileToPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(toJpeg(img, img.naturalWidth, img.naturalHeight));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a photo this browser can read.'));
    };
    img.src = url;
  });
}

/** A frame from the live camera view. */
export function videoToPhoto(video: HTMLVideoElement): string {
  return toJpeg(video, video.videoWidth, video.videoHeight);
}

/** Live in-page camera needs a secure page (https or this computer). Tablets on plain http use the camera app. */
export function canUseLiveCamera() {
  return (
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    !window.matchMedia('(pointer: coarse)').matches
  );
}
