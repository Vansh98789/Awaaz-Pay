import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (qrData: string) => void;
  speak: (text: string, options?: { lang?: string }) => void;
  lang: 'hi-IN' | 'en-IN';
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  speak,
  lang,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [guidanceStatus, setGuidanceStatus] = useState<string>('Searching for QR code...');

  const lastGuidanceTimeRef = useRef<number>(0);
  const scanningActiveRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    scanningActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      scanningActiveRef.current = true;

      const initialGuidance =
        lang === 'hi-IN'
          ? 'Camera khul gaya hai. QR code ko frame ke beech mein layein.'
          : 'Camera ready. Center the QR code in the frame.';
      speak(initialGuidance, { lang });
      setGuidanceStatus(initialGuidance);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        requestAnimationFrame(scanFrame);
      }
    } catch (err) {
      const msg = (err as Error).message;
      setCameraError(`Camera access denied or unavailable: ${msg}`);
      const errGuidance =
        lang === 'hi-IN'
          ? 'Camera access nahi mil paya. Kripya permission check karein.'
          : 'Could not access camera. Please check permissions.';
      speak(errGuidance, { lang });
    }
  };

  const triggerGuidance = (direction: 'left' | 'right' | 'found') => {
    const now = Date.now();
    if (now - lastGuidanceTimeRef.current < 2500 && direction !== 'found') {
      return;
    }
    lastGuidanceTimeRef.current = now;

    let text = '';
    if (direction === 'left') {
      text = lang === 'hi-IN' ? 'Thoda baayein' : 'A little left';
    } else if (direction === 'right') {
      text = lang === 'hi-IN' ? 'Thoda daayein' : 'A little right';
    } else if (direction === 'found') {
      text = lang === 'hi-IN' ? 'QR mil gaya!' : 'QR code found!';
    }

    setGuidanceStatus(text);
    speak(text, { lang });
  };

  const scanFrame = async () => {
    if (!scanningActiveRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);

        let qrData: string | null = null;
        let centerX: number | null = null;

        // 1. Try BarcodeDetector API if available
        const win = window as unknown as {
          BarcodeDetector?: {
            new (options: { formats: string[] }): {
              detect: (image: HTMLVideoElement | HTMLCanvasElement) => Promise<
                Array<{
                  rawValue: string;
                  boundingBox: { x: number; y: number; width: number; height: number };
                }>
              >;
            };
          };
        };

        if (win.BarcodeDetector) {
          try {
            const detector = new win.BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              const b = barcodes[0];
              qrData = b.rawValue;
              centerX = b.boundingBox.x + b.boundingBox.width / 2;
            }
          } catch {
            // Fallback to jsQR
          }
        }

        // 2. jsQR Fallback
        if (!qrData) {
          const imageData = ctx.getImageData(0, 0, width, height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code) {
            qrData = code.data;
            centerX = (code.location.topLeftCorner.x + code.location.topRightCorner.x) / 2;
          }
        }

        // Evaluate location and trigger guidance or success
        if (qrData && centerX !== null) {
          const ratio = centerX / width;

          if (ratio < 0.35) {
            triggerGuidance('right');
          } else if (ratio > 0.65) {
            triggerGuidance('left');
          } else {
            triggerGuidance('found');
            scanningActiveRef.current = false;
            stopCamera();
            onScanSuccess(qrData);
            return;
          }
        }
      }
    }

    if (scanningActiveRef.current) {
      requestAnimationFrame(scanFrame);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invoice QR Code Scanner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
            📷 {lang === 'hi-IN' ? 'Invoice QR Scan' : 'Scan Invoice QR'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="action-pill-btn"
            style={{ fontSize: '1.2rem', padding: '0.25rem 0.75rem', cursor: 'pointer' }}
            aria-label="Close scanner"
          >
            ✕
          </button>
        </div>

        {/* Live Video Viewport with Target Framing Overlay */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: '360px',
            height: '360px',
            borderRadius: '1.25rem',
            overflow: 'hidden',
            border: '2px solid var(--accent-cyan)',
            boxShadow: '0 0 30px var(--accent-cyan-glow)',
            backgroundColor: '#000000',
          }}
        >
          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Center Target Reticle */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '200px',
              height: '200px',
              border: '2px dashed #ffffff',
              borderRadius: '1rem',
              boxShadow: '0 0 0 2000px rgba(0, 0, 0, 0.4)',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Live Audio & Visual Guidance Banner */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '0.75rem',
            padding: '0.75rem 1.25rem',
            width: '100%',
            textAlign: 'center',
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--accent-cyan)',
          }}
        >
          🎙️ {guidanceStatus}
        </div>

        {cameraError && (
          <p className="error-banner" style={{ width: '100%' }}>
            ⚠️ {cameraError}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="auth-secondary-btn"
          style={{ width: '100%', marginTop: '0.5rem' }}
        >
          {lang === 'hi-IN' ? 'Band Karein (Cancel)' : 'Cancel Scanning'}
        </button>
      </div>
    </div>
  );
};
