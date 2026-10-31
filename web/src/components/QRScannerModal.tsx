import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Headline, BodyText } from '../design/index.js';
import { triggerHaptic } from '../hooks/useHaptics.js';

interface QRScannerModalProps {
  isOpen: boolean;
  cameraCommand?: number;
  onScanSuccess: (qrData: string) => void;
  onReturnHome: () => void;
  allowEmailRecipient?: boolean;
  emailEntryOpen?: boolean;
  onEmailEntryOpenChange?: (open: boolean) => void;
  onUseEmail?: (email: string) => void | Promise<void>;
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
  cameraCommand = 0,
  onScanSuccess,
  onReturnHome,
  allowEmailRecipient = false,
  emailEntryOpen = false,
  onEmailEntryOpenChange,
  onUseEmail,
  speak,
  lang,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [displayMessage, setDisplayMessage] = useState<string>('Point the camera at the code');
  const [timeoutExpired, setTimeoutExpired] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [submittingEmail, setSubmittingEmail] = useState(false);

  const lastSpokenGuidanceRef = useRef<GuidanceMessage | null>(null);
  const lastSpokenTimeRef = useRef<number>(0);
  const scanningActiveRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanTimeRef = useRef(0);
  const barcodeDetectorRef = useRef<any>(null);

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
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      barcodeDetectorRef.current = BarcodeDetectorClass
        ? new BarcodeDetectorClass({ formats: ['qr_code'] })
        : null;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
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
      const errGuidance = lang === 'hi-IN'
        ? 'Camera nahi khul paya. Dobara koshish ke liye dobara scan bolo, ya recipient ka email mic mein boliye.'
        : 'Could not access the camera. Say scan again, or speak the recipient’s email into the microphone.';
      speak(errGuidance, { lang });
    }
  };

  useEffect(() => {
    if (!isOpen || emailEntryOpen) {
      stopCamera();
      if (!isOpen) setRecipientEmail('');
      return;
    }
    setCameraError(null);
    setTimeoutExpired(false);
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen, cameraCommand, emailEntryOpen]);

  const scanFrame = async () => {
    if (!scanningActiveRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Decode at a steady 10 fps instead of consuming a full CPU core on every
    // display frame. This keeps the camera preview and the rest of the UI responsive.
    const now = performance.now();
    if (now - lastScanTimeRef.current < 100) {
      requestAnimationFrame(scanFrame);
      return;
    }
    lastScanTimeRef.current = now;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const scale = Math.min(1, 480 / width);
      const scanWidth = Math.round(width * scale);
      const scanHeight = Math.round(height * scale);
      canvas.width = scanWidth;
      canvas.height = scanHeight;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, scanWidth, scanHeight);

        let qrData: string | null = null;
        let boxWidth = 0;
        let centerX = 0;

        // 1. BarcodeDetector API
        if (barcodeDetectorRef.current) {
          try {
            const barcodes = await barcodeDetectorRef.current.detect(video);
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
          const imageData = ctx.getImageData(0, 0, scanWidth, scanHeight);
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
          const detectedFrameWidth = barcodeDetectorRef.current ? width : scanWidth;
          const xRatio = centerX / detectedFrameWidth;
          const sizeRatio = boxWidth / detectedFrameWidth;

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
      <header style={{ width: '100%', maxWidth: '520px', textAlign: 'center' }}>
        <button
          type="button"
          onClick={onReturnHome}
          aria-label={lang === 'hi-IN' ? 'Wallet home par wapas jaayein' : 'Return to Wallet home'}
          style={{ minHeight: 56, marginBottom: '0.75rem', padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
        >
          {lang === 'hi-IN' ? '← वॉलेट होम' : '← Wallet home'}
        </button>
        <Headline level={1}>{lang === 'hi-IN' ? 'QR Code Scan' : 'Scan a QR code'}</Headline>
        <BodyText muted style={{ marginTop: '0.5rem' }}>
          {allowEmailRecipient
            ? (lang === 'hi-IN' ? 'Chunein: QR scan karein ya PayPal email se pay karein. Email bol sakte hain ya type kar sakte hain.' : 'Choose: scan a QR or pay by PayPal email. You can say or type the email.')
            : (lang === 'hi-IN'
              ? 'Invoice QR ya Awaaz Pay recipient QR scan karein. Recipient QR mein naam aur PayPal email hota hai.'
              : 'Scan a PayPal invoice QR or an Awaaz Pay recipient QR. Recipient codes contain a name and PayPal email.')}
        </BodyText>
        {/* Prominent Spoken & Live Status Guidance */}
        {!emailEntryOpen && <div
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
        </div>}
      </header>

      {allowEmailRecipient && !emailEntryOpen && (
        <button
          type="button"
          onClick={() => {
            onEmailEntryOpenChange?.(true);
            speak(lang === 'hi-IN' ? 'PayPal email boliye ya neeche type karke continue dabaiye.' : 'Say the PayPal email, or type it below and press Continue.', { lang });
          }}
          style={{ minHeight: 56, padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
        >
          {lang === 'hi-IN' ? 'PayPal email se pay karein' : 'Pay by PayPal email'}
        </button>
      )}

      {/* Main Viewfinder with Braille Dot Frame Overlay */}
      {!emailEntryOpen && <main
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
      </main>}

      {allowEmailRecipient && emailEntryOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = recipientEmail.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || submittingEmail) return;
            setSubmittingEmail(true);
            Promise.resolve(onUseEmail?.(value)).finally(() => setSubmittingEmail(false));
          }}
          style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '1.25rem', borderRadius: 'var(--radius-card, 16px)', border: '2px solid var(--border)', background: 'var(--surface)' }}
        >
          <BodyText size="large" style={{ fontWeight: 750 }}>{lang === 'hi-IN' ? 'PayPal Sandbox email' : 'PayPal Sandbox email'}</BodyText>
          <label htmlFor="scanner-recipient-email" style={{ fontWeight: 650 }}>{lang === 'hi-IN' ? 'Email boliye ya type karein' : 'Say or type the recipient’s email'}</label>
          <input
            id="scanner-recipient-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={submittingEmail}
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="name@example.com"
            style={{ minHeight: 56, width: '100%', boxSizing: 'border-box', padding: '0.75rem', borderRadius: 'var(--radius-card, 12px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button type="submit" disabled={submittingEmail} style={{ minHeight: 56, flex: '1 1 170px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: submittingEmail ? 'wait' : 'pointer', opacity: submittingEmail ? 0.7 : 1 }}>
              {submittingEmail ? (lang === 'hi-IN' ? 'Taiyaar ho raha hai…' : 'Preparing…') : (lang === 'hi-IN' ? 'Email se continue karein' : 'Continue with email')}
            </button>
            <button type="button" onClick={() => onEmailEntryOpenChange?.(false)} style={{ minHeight: 56, flex: '1 1 140px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}>
              {lang === 'hi-IN' ? 'QR par wapas' : 'Back to QR scan'}
            </button>
          </div>
        </form>
      )}

      <footer style={{ width: '100%', maxWidth: '420px', textAlign: 'center' }}>
        <BodyText muted>
          {emailEntryOpen
            ? (lang === 'hi-IN' ? 'Email bolkar ya type karke continue karein, ya QR scan par wapas jaayein.' : 'Say or type the email and continue, or return to QR scanning.')
            : timeoutExpired || cameraError
            ? lang === 'hi-IN' ? 'Dobara scan ke liye “dobara scan karo” bolein. Band karne ke liye “scanner band karo” bolein.' : 'Say “scan again” to retry, or “close scanner” to exit.'
          : lang === 'hi-IN' ? 'Scanner band karne ke liye “scanner band karo” bolein, ya Wallet home button dabayein.' : 'Say “close scanner” or use the Wallet home button to exit.'}
        </BodyText>
      </footer>
    </div>
  );
};
