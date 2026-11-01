import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Headline, BodyText, DotWordmark } from '../design/index.js';
import { triggerHaptic } from '../hooks/useHaptics.js';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js';

interface QRScannerModalProps {
  isOpen: boolean;
  cameraCommand?: number;
  onScanSuccess: (qrData: string) => void;
  onReturnHome: () => void;
  allowEmailRecipient?: boolean;
  emailEntryOpen?: boolean;
  onEmailEntryOpenChange?: (open: boolean) => void;
  onUseEmail?: (email: string) => void | Promise<void>;
  onStartEmailPayment?: (utterance: string) => void | Promise<void>;
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
  onStartEmailPayment,
  speak,
  lang,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<string>('Point the camera at the code');
  const [timeoutExpired, setTimeoutExpired] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [retryCounter, setRetryCounter] = useState(0);
  const [emailIntentStarting, setEmailIntentStarting] = useState(false);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const speakRef = useRef(speak);
  speakRef.current = speak;

  const handleScannerVoice = (text: string) => {
    if (/\b(close|exit|back to wallet|wallet home|band karo|ghar)\b/i.test(text) || /वापस|बंद/.test(text)) {
      scannerVoice.stopListening();
      onReturnHome();
      return;
    }
    if (/\b(scan again|retry|try again|dobara scan)\b/i.test(text) || /फिर से स्कैन/.test(text)) {
      scannerVoice.stopListening();
      setCameraError(null);
      setTimeoutExpired(false);
      setRetryCounter((count) => count + 1);
      const retry = lang === 'hi-IN' ? 'QR scan dobara shuru kar raha hoon.' : 'Restarting the QR scanner.';
      setVoiceMessage(retry);
      speak(retry, { lang });
      return;
    }
    const normalized = text.trim().replace(/[.,!?;:।]/g, ' ');
    const spokenEmail = normalized
      .replace(/\b(at|और|ऐट)\b/gi, '@')
      .replace(/\b(dot|डॉट)\b/gi, '.')
      .replace(/\s*([@.])\s*/g, '$1')
      .replace(/\s+/g, '');
    const email = spokenEmail.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];

    if (email) {
      setRecipientEmail(email);
      onEmailEntryOpenChange?.(true);
      if (!allowEmailRecipient) {
        setEmailIntentStarting(true);
        void Promise.resolve(onStartEmailPayment?.('I want to pay money by PayPal email')).finally(() => {
          setEmailIntentStarting(false);
          queueListening(2200);
        });
      }
      setVoiceMessage(lang === 'hi-IN' ? `ईमेल सुना: ${email}. भेजने से पहले जाँचें।` : `Email heard: ${email}. Check it before continuing.`);
      speak(lang === 'hi-IN' ? `ईमेल सुना ${email}. जारी रखने से पहले इसे जाँचें।` : `I heard ${email}. Check it before continuing.`, { lang });
      if (allowEmailRecipient) queueListening(1800);
      return;
    }

    if (/\b(email|e-mail|pay by email|email se)\b/i.test(text) || /ईमेल/.test(text)) {
      if (!allowEmailRecipient) {
        setEmailIntentStarting(true);
        onEmailEntryOpenChange?.(true);
        setVoiceMessage(lang === 'hi-IN' ? 'Email se payment shuru kar rahe hain.' : 'Starting an email payment.');
        scannerVoice.stopListening();
        void Promise.resolve(onStartEmailPayment?.(text)).finally(() => {
          setEmailIntentStarting(false);
          queueListening(2200);
        });
        return;
      }
      onEmailEntryOpenChange?.(true);
      const prompt = lang === 'hi-IN' ? 'PayPal email boliye ya neeche type karein.' : 'Say the recipient’s PayPal email, or type it below.';
      setVoiceMessage(prompt);
      speak(prompt, { lang });
      scannerVoice.stopListening();
      queueListening(1800);
      return;
    }

    if (/\b(scan|scanner|qr|camera)\b/i.test(text) || /स्कैन|कैमरा/.test(text)) {
      const prompt = lang === 'hi-IN' ? 'Theek hai, QR code ko camera ke saamne rakhein.' : 'Okay, hold the QR code in front of the camera.';
      setVoiceMessage(prompt);
      speak(prompt, { lang });
      void onStartEmailPayment?.(text);
      queueListening(1800);
      return;
    }

    const prompt = lang === 'hi-IN' ? 'Main samajh rahi hoon. QR scan karein ya PayPal email se pay karein?' : 'I’m listening. Would you like to scan a QR code or pay by PayPal email?';
    setVoiceMessage(prompt);
    speak(prompt, { lang });
    void onStartEmailPayment?.(text);
    queueListening(1800);
  };

  const scannerVoice = useSpeechRecognition({
    lang,
    onResult: handleScannerVoice,
    onError: (_code, friendlyMessage) => {
      setVoiceMessage(friendlyMessage);
      speak(friendlyMessage, { lang });
    },
  });

  const queueListening = (delayMs: number) => {
    if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
    voiceRestartTimerRef.current = setTimeout(() => {
      voiceRestartTimerRef.current = null;
      if (isOpenRef.current && scannerVoice.isSupported && !scannerVoice.isListening) scannerVoice.startListening();
    }, delayMs);
  };

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
    setCameraReady(false);
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
      setCameraReady(false);
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

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      if (!scanningActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      barcodeDetectorRef.current = BarcodeDetectorClass
        ? new BarcodeDetectorClass({ formats: ['qr_code'] })
        : null;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        if (!scanningActiveRef.current) return;
        setCameraReady(true);
        timeoutTimerRef.current = setTimeout(() => {
          if (scanningActiveRef.current) {
            stopCamera();
            setTimeoutExpired(true);
            const timeoutMsg = lang === 'hi-IN'
              ? 'Koi code nahi mila. Kya aap dobara koshish karenge ya cancel karenge?'
              : 'No code found after 20 seconds. Would you like to try again or cancel?';
            speak(timeoutMsg, { lang });
            setDisplayMessage(timeoutMsg);
          }
        }, 20000);
        requestAnimationFrame(scanFrame);
      }
    } catch (err) {
      if (!scanningActiveRef.current) return;
      stopCamera();
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
    if (!isOpen) {
      scannerVoice.stopListening();
      if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
  }, [isOpen, scannerVoice.stopListening]);

  useEffect(() => {
    if (!isOpen) return;
    const prompt = lang === 'hi-IN'
      ? 'Aap QR scan karna chahte hain ya PayPal email se pay karna? Bolkar ya neeche button dabakar chunein.'
      : 'Would you like to scan a QR code or pay by PayPal email? Say your choice, or tap an option below.';
    setVoiceMessage(prompt);
    speakRef.current(prompt, { lang });
    if (scannerVoice.isSupported) {
      // Wait for the spoken prompt to finish so speech recognition does not hear its own prompt.
      const timer = setTimeout(() => scannerVoice.startListening(), 2400);
      return () => clearTimeout(timer);
    }
  }, [isOpen, lang, scannerVoice.isSupported, scannerVoice.startListening]);

  useEffect(() => {
    if (emailEntryOpen) emailInputRef.current?.focus();
  }, [emailEntryOpen]);

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
  }, [isOpen, cameraCommand, emailEntryOpen, retryCounter]);

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

        if (!scanningActiveRef.current) return;

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
        justifyContent: 'flex-start',
        gap: '1.25rem',
        overflowY: 'auto',
        padding: 'max(1rem, env(safe-area-inset-top)) 1.25rem max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <header style={{ width: '100%', maxWidth: '560px', textAlign: 'left' }}>
        <div style={{ minHeight: 64, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
          <DotWordmark size={92} />
          <button
            type="button"
            onClick={onReturnHome}
            aria-label={lang === 'hi-IN' ? 'Wallet home par wapas jaayein' : 'Return to Wallet home'}
            style={{ minHeight: 64, padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
          >
            {lang === 'hi-IN' ? '← वॉलेट' : '← Wallet'}
          </button>
        </div>
        <Headline level={1}>{emailEntryOpen ? (lang === 'hi-IN' ? 'ईमेल से भुगतान करें' : 'Pay by email') : (lang === 'hi-IN' ? 'QR code scan karein' : 'Scan a QR code')}</Headline>
        <BodyText muted style={{ marginTop: '0.5rem', maxWidth: '48ch' }}>
          {allowEmailRecipient
            ? (lang === 'hi-IN' ? 'Chunein: QR scan karein ya PayPal email se pay karein. Email bol sakte hain ya type kar sakte hain.' : 'Choose: scan a QR or pay by PayPal email. You can say or type the email.')
            : (lang === 'hi-IN'
              ? 'Invoice QR ya Awaaz Pay recipient QR scan karein. Recipient QR mein naam aur PayPal email hota hai.'
              : 'Scan a PayPal invoice QR or an Awaaz Pay recipient QR. Recipient codes contain a name and PayPal email.')}
        </BodyText>
        <button
            type="button"
            aria-pressed={scannerVoice.isListening}
            disabled={!scannerVoice.isSupported}
            onClick={() => { setVoiceMessage(''); scannerVoice.toggleListening(); }}
            aria-label={lang === 'hi-IN' ? (scannerVoice.isListening ? 'Bolna band karein' : 'Scanner ko awaaz se control karein') : (scannerVoice.isListening ? 'Stop speaking' : 'Use the scanner microphone')}
            style={{ minHeight: 64, minWidth: 200, marginTop: '1rem', padding: '0.75rem 1.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: scannerVoice.isListening ? 'var(--text)' : 'var(--accent)', color: scannerVoice.isListening ? 'var(--bg)' : 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: scannerVoice.isSupported ? 'pointer' : 'not-allowed', opacity: scannerVoice.isSupported ? 1 : 0.55 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
            </svg>
            {scannerVoice.isListening
              ? (lang === 'hi-IN' ? 'सुनना रोकें' : 'Stop listening')
              : (lang === 'hi-IN' ? 'बोलें' : 'Tap to speak')}
        </button>
        {scannerVoice.isListening && (
          <div role="status" aria-live="polite" style={{ marginTop: '0.5rem' }}>
            <BodyText>{lang === 'hi-IN' ? 'सुन रही हूँ। Email se pay, dobara scan, ya scanner band boliye.' : 'Listening. Say “pay by email”, “scan again”, or “close scanner”.'}</BodyText>
          </div>
        )}
        {voiceMessage && (
          <div role="status" aria-live="polite" style={{ marginTop: '0.5rem' }}><BodyText>{voiceMessage}</BodyText></div>
        )}
        {!scannerVoice.isSupported && (
          <div role="status" aria-live="polite" style={{ marginTop: '0.5rem' }}>
            <BodyText muted>
              {allowEmailRecipient
                ? (lang === 'hi-IN' ? 'इस ब्राउज़र में बोलकर खोज उपलब्ध नहीं है। ईमेल बटन से पता टाइप करें।' : 'Voice input is unavailable in this browser. Use the email option to type the address.')
                : (lang === 'hi-IN' ? 'इस ब्राउज़र में बोलकर कमांड उपलब्ध नहीं हैं।' : 'Voice commands are unavailable in this browser.')}
            </BodyText>
          </div>
        )}
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
        </div>}
      </header>

      {/* Main Viewfinder with Braille Dot Frame Overlay */}
      {!emailEntryOpen && <main
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '560px',
          height: 'clamp(220px, 34vh, 360px)',
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

        {!cameraReady && !cameraError && !timeoutExpired && (
          <div role="status" aria-live="polite" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,0.48)', color: '#fff', textAlign: 'center' }}>
            <BodyText size="large" style={{ fontWeight: 700 }}>{lang === 'hi-IN' ? 'कैमरा शुरू हो रहा है…' : 'Starting camera…'}</BodyText>
          </div>
        )}

        {/* Dotted target frame overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: 'min(62vw, 240px)',
            aspectRatio: '1',
            border: '3px solid rgba(255,255,255,0.9)',
            borderRadius: '24px',
            boxShadow: '0 0 0 999px rgba(0,0,0,0.28)',
            pointerEvents: 'none',
          }}
        />
        {(cameraError || timeoutExpired) && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1.25rem', textAlign: 'center', background: 'rgba(0,0,0,0.82)', color: '#fff' }}>
            <BodyText size="large" style={{ fontWeight: 700 }}>{cameraError || (lang === 'hi-IN' ? 'QR code nahi mila.' : 'No QR code found yet.')}</BodyText>
            <button type="button" onClick={() => { setCameraError(null); setTimeoutExpired(false); setRetryCounter((count) => count + 1); }} style={{ minHeight: 64, padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-pill)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}>
              {lang === 'hi-IN' ? 'कैमरा फिर शुरू करें' : 'Try camera again'}
            </button>
          </div>
        )}
      </main>}

      {!emailEntryOpen && (
        <div style={{ width: '100%', maxWidth: '560px', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        <button
          type="button"
          onClick={() => {
            setVoiceMessage(lang === 'hi-IN' ? 'QR code camera ke saamne rakhein.' : 'Hold a QR code in front of the camera.');
            scannerVoice.stopListening();
            speak(lang === 'hi-IN' ? 'QR code camera ke saamne rakhein.' : 'Hold a QR code in front of the camera.', { lang });
          }}
          style={{ minHeight: 64, flex: '1 1 200px', padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
        >
          {lang === 'hi-IN' ? 'QR code scan karein' : 'Scan a QR code'}
        </button>
        <button
          type="button"
          onClick={() => {
            onEmailEntryOpenChange?.(true);
            setVoiceMessage(lang === 'hi-IN' ? 'PayPal email boliye ya type karein.' : 'Say or type the recipient’s PayPal email.');
            scannerVoice.stopListening();
            if (!allowEmailRecipient) {
              setEmailIntentStarting(true);
              void Promise.resolve(onStartEmailPayment?.('I want to pay money by PayPal email')).finally(() => {
                setEmailIntentStarting(false);
                queueListening(700);
              });
            } else {
              queueListening(1600);
            }
            speak(lang === 'hi-IN' ? 'PayPal email boliye ya type karein.' : 'Say or type the recipient’s PayPal email.', { lang });
          }}
          style={{ minHeight: 64, flex: '1 1 200px', padding: '0.7rem 1.2rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}
        >
          {lang === 'hi-IN' ? 'PayPal email se pay karein' : 'Pay by PayPal email'}
        </button>
        </div>
      )}

      {emailEntryOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = recipientEmail.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || submittingEmail) return;
            setSubmittingEmail(true);
            Promise.resolve(onUseEmail?.(value)).finally(() => setSubmittingEmail(false));
          }}
          style={{ width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem', borderRadius: 'var(--radius-card, 16px)', border: '2px solid var(--border)', background: 'var(--surface)' }}
        >
          <BodyText size="large" style={{ fontWeight: 750 }}>{lang === 'hi-IN' ? 'Kisko payment bhejni hai?' : 'Who would you like to pay?'}</BodyText>
          <BodyText muted>{lang === 'hi-IN' ? 'Recipient ka PayPal Sandbox email boliye ya type karein. Aage badhne se pehle aapko ise check karne ka mauka milega.' : 'Say or enter the recipient’s PayPal Sandbox email. You will be able to review it before continuing.'}</BodyText>
          {emailIntentStarting && <div role="status" aria-live="polite"><BodyText>{lang === 'hi-IN' ? 'Email payment taiyaar kar rahe hain…' : 'Getting email payment ready…'}</BodyText></div>}
          <label htmlFor="scanner-recipient-email" style={{ fontWeight: 650 }}>{lang === 'hi-IN' ? 'PayPal email' : 'Recipient’s PayPal email'}</label>
          <input
            ref={emailInputRef}
            id="scanner-recipient-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={submittingEmail || emailIntentStarting}
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder="name@example.com"
            style={{ minHeight: 64, width: '100%', boxSizing: 'border-box', padding: '0.75rem', borderRadius: 'var(--radius-card, 12px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button type="submit" disabled={submittingEmail || emailIntentStarting} style={{ minHeight: 64, flex: '1 1 170px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: submittingEmail || emailIntentStarting ? 'wait' : 'pointer', opacity: submittingEmail || emailIntentStarting ? 0.7 : 1 }}>
              {submittingEmail ? (lang === 'hi-IN' ? 'Taiyaar ho raha hai…' : 'Preparing…') : emailIntentStarting ? (lang === 'hi-IN' ? 'Taiyaar ho raha hai…' : 'Getting ready…') : (lang === 'hi-IN' ? 'Email check karein' : 'Review email')}
            </button>
            <button type="button" onClick={() => onEmailEntryOpenChange?.(false)} style={{ minHeight: 64, flex: '1 1 140px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}>
              {lang === 'hi-IN' ? 'QR par wapas' : 'Back to QR scan'}
            </button>
          </div>
        </form>
      )}

      <footer style={{ width: '100%', maxWidth: '560px', textAlign: 'left' }}>
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
