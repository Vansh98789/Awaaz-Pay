import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { BigButton, Headline, BodyText } from '../design/index.js';
import { triggerHaptic } from '../hooks/useHaptics.js';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (qrData: string) => void;
  speak: (text: string, options?: { lang?: string }) => void;
  lang: 'hi-IN' | 'en-IN';
}

type GuidanceMessage =
  | 'point_camera'
  | 'little_left'
  | 'little_right'
  | 'move_closer'
  | 'move_further'
  | 'hold_steady'
  | 'code_found';

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
  const [displayMessage, setDisplayMessage] = useState<string>('Point the camera at the code');
  const [showManualInput, setShowManualInput] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>('');
  const [timeoutExpired, setTimeoutExpired] = useState<boolean>(false);
  const [cameraStarted, setCameraStarted] = useState<boolean>(false);

  const lastSpokenGuidanceRef = useRef<GuidanceMessage | null>(null);
  const lastSpokenTimeRef = useRef<number>(0);
  const scanningActiveRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getGuidanceText = (msg: GuidanceMessage): string => {
    switch (msg) {
      case 'point_camera':
        return lang === 'hi-IN' ? 'Camera code par layein' : 'Point the camera at the code';
      case 'little_left':
        return lang === 'hi-IN' ? 'Thoda baayein' : 'A little to the left';
      case 'little_right':
        return lang === 'hi-IN' ? 'Thoda daayein' : 'A little to the right';
      case 'move_closer':
        return lang === 'hi-IN' ? 'Thoda paas layein' : 'Move closer';
      case 'move_further':
        return lang === 'hi-IN' ? 'Thoda door karein' : 'Move further away';
      case 'hold_steady':
        return lang === 'hi-IN' ? 'Camera sthir rakhein' : 'Hold steady';
      case 'code_found':
        return lang === 'hi-IN' ? 'Code mil gaya!' : 'Code found';
    }
  };

  const triggerGuidance = (msg: GuidanceMessage) => {
    const now = Date.now();
    // Repeated at most every 2 seconds and ONLY when they change (unless code_found)
    if (msg !== 'code_found') {
      if (lastSpokenGuidanceRef.current === msg && now - lastSpokenTimeRef.current < 2000) {
        return;
      }
    }

    lastSpokenGuidanceRef.current = msg;
    lastSpokenTimeRef.current = now;

    const text = getGuidanceText(msg);
    setDisplayMessage(text);
    speak(text, { lang });
  };

  const stopCamera = () => {
    scanningActiveRef.current = false;
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      setTimeoutExpired(false);
      scanningActiveRef.current = true;

      if (!window.isSecureContext) {
        throw new Error(lang === 'hi-IN'
          ? 'Camera ke liye HTTPS zaroori hai. App ko https:// address se kholein.'
          : 'Camera access requires HTTPS. Open Awaaz Pay using its https:// address.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(lang === 'hi-IN'
          ? 'Is browser mein camera access supported nahi hai.'
          : 'Camera access is not supported by this browser.');
      }

      // 20-second timeout
      timeoutTimerRef.current = setTimeout(() => {
        if (scanningActiveRef.current) {
          setTimeoutExpired(true);
          const timeoutMsg =
            lang === 'hi-IN'
              ? 'Koi code nahi mila. Kya aap dobara koshish karenge ya cancel karenge?'
              : 'No code found after 20 seconds. Would you like to try again or cancel?';
          speak(timeoutMsg, { lang });
          setDisplayMessage(timeoutMsg);
        }
      }, 20000);

      triggerGuidance('point_camera');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraStarted(true);
        requestAnimationFrame(scanFrame);
      }
    } catch (err) {
      scanningActiveRef.current = false;
      const error = err as Error & { name?: string };
      const msg = error.message.startsWith('Camera access') || error.message.startsWith('Is browser') || error.message.startsWith('Camera ke')
        ? error.message
        : error.name === 'NotAllowedError'
          ? (lang === 'hi-IN'
            ? 'Camera permission blocked hai. Browser site settings mein Camera ko Allow karein.'
            : 'Camera permission is blocked. Allow Camera in this site’s browser settings.')
          : error.name === 'NotFoundError'
            ? (lang === 'hi-IN' ? 'Camera nahi mila.' : 'No camera was found on this device.')
            : (lang === 'hi-IN' ? 'Camera nahi khul paya. Dobara koshish karein.' : 'Could not open the camera. Please try again.');
      setCameraError(msg);
      setDisplayMessage(msg);
      const errGuidance =
        lang === 'hi-IN'
          ? 'Camera nahi khul paya. Kripya code manually dalein.'
          : 'Could not access camera. Please enter code manually.';
      speak(errGuidance, { lang });
      setShowManualInput(true);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }
    setCameraStarted(false);
    setCameraError(null);
    setTimeoutExpired(false);
    return () => {
      stopCamera();
    };
  }, [isOpen]);

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
        let boxWidth = 0;
        let centerX = 0;

        // 1. BarcodeDetector API
        const win = window as any;
        if (win.BarcodeDetector) {
          try {
            const detector = new win.BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              const b = barcodes[0];
              qrData = b.rawValue;
              boxWidth = b.boundingBox.width;
              centerX = b.boundingBox.x + boxWidth / 2;
            }
          } catch {
            // Fall back to jsQR
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
            boxWidth = Math.abs(code.location.topRightCorner.x - code.location.topLeftCorner.x);
            centerX = (code.location.topLeftCorner.x + code.location.topRightCorner.x) / 2;
          }
        }

        // Compute positioning & distance guidance
        if (qrData) {
          const xRatio = centerX / width;
          const sizeRatio = boxWidth / width;

          if (xRatio < 0.35) {
            triggerGuidance('little_right');
          } else if (xRatio > 0.65) {
            triggerGuidance('little_left');
          } else if (sizeRatio < 0.25) {
            triggerGuidance('move_closer');
          } else if (sizeRatio > 0.75) {
            triggerGuidance('move_further');
          } else {
            // Success
            triggerHaptic('understood');
            triggerGuidance('code_found');
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

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    triggerHaptic('understood');
    stopCamera();
    onScanSuccess(manualCode.trim());
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QR Code Scanner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'var(--bg)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2rem 1.25rem',
      }}
    >
      <header style={{ width: '100%', textAlign: 'center' }}>
        <Headline level={1}>{lang === 'hi-IN' ? 'QR Code Scan' : 'Scan a QR code'}</Headline>
        <BodyText muted style={{ marginTop: '0.5rem' }}>
          {lang === 'hi-IN'
            ? 'Invoice QR ya Awaaz Pay recipient QR scan karein. Recipient QR mein naam aur PayPal email hota hai.'
            : 'Scan a PayPal invoice QR or an Awaaz Pay recipient QR. Recipient codes contain a name and PayPal email.'}
        </BodyText>
        {/* Prominent Spoken & Live Status Guidance */}
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: 'var(--surface)',
            border: '2px solid var(--border)',
            borderRadius: 'var(--radius-card, 16px)',
          }}
        >
          <BodyText size="large" style={{ fontWeight: 700 }}>
            {displayMessage}
          </BodyText>
          {cameraError && (
            <div style={{ color: 'var(--danger)', marginTop: '0.5rem', fontWeight: 700 }}>
              {cameraError}
            </div>
          )}
        </div>
      </header>

      {/* Main Viewfinder with Braille Dot Frame Overlay */}
      <main
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '420px',
          height: '320px',
          backgroundColor: '#000000',
          borderRadius: 'var(--radius-card, 16px)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Dotted target frame overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: '200px',
            height: '200px',
            border: '4px dashed var(--accent)',
            borderRadius: '16px',
            pointerEvents: 'none',
          }}
        />
      </main>

      {(!cameraStarted && !showManualInput) || cameraError ? (
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <BigButton variant="primary" onClick={startCamera}>
            {cameraError
              ? (lang === 'hi-IN' ? 'Camera dobara koshish karein' : 'Try camera again')
              : (lang === 'hi-IN' ? 'Camera chalu karein' : 'Enable camera and scan')}
          </BigButton>
        </div>
      ) : null}

      {timeoutExpired && (
        <div style={{ width: '100%', maxWidth: '420px' }}>
          <BigButton
            variant="primary"
            onClick={() => {
              stopCamera();
              startCamera();
            }}
          >
            {lang === 'hi-IN' ? 'Dobara koshish karein' : 'Try Again'}
          </BigButton>
        </div>
      )}

      {/* Helper manual code input option */}
      {showManualInput ? (
        <form
          onSubmit={handleManualSubmit}
          style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        >
          <label htmlFor="manual-qr-input" style={{ fontSize: 'var(--text-body)', fontWeight: 700 }}>
            {lang === 'hi-IN' ? 'Invoice code ya link yahan dalein:' : 'Enter invoice code or link:'}
          </label>
          <input
            id="manual-qr-input"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="INV2-DEMO-RAVI-250"
            style={{
              minHeight: 'var(--min-target, 64px)',
              padding: '0.75rem 1rem',
              fontSize: 'var(--text-body, 1.25rem)',
              borderRadius: 'var(--radius-card, 16px)',
              border: '2px solid var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          <BigButton type="submit" variant="primary">
            {lang === 'hi-IN' ? 'Code Submit Karein' : 'Submit Code'}
          </BigButton>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowManualInput(true)}
          style={{
            minHeight: 'var(--min-target, 64px)',
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            fontSize: 'var(--text-body, 1.25rem)',
            fontWeight: 700,
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {lang === 'hi-IN' ? 'Enter code manually (Helper ke liye)' : 'Enter code manually'}
        </button>
      )}

      {/* Large 64px Cancel Button */}
      <footer style={{ width: '100%', maxWidth: '420px' }}>
        <BigButton variant="secondary" onClick={onClose}>
          {lang === 'hi-IN' ? 'Cancel karein' : 'Cancel'}
        </BigButton>
      </footer>
    </div>
  );
};
