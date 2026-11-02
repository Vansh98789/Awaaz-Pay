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
  onUseEmail?: (email: string, amount?: number) => void | Promise<void>;
  onStartEmailPayment?: (utterance: string) => void | Promise<void>;
  speak: (text: string, options?: { lang?: string; onEnd?: () => void }) => void;
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
  const [scannerMode, setScannerMode] = useState<'choice' | 'scan'>('choice');
  const [displayMessage, setDisplayMessage] = useState<string>('Point the camera at the code');
  const [timeoutExpired, setTimeoutExpired] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientAmount, setRecipientAmount] = useState('');
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailSubmitError, setEmailSubmitError] = useState('');
  const [voiceMessage, setVoiceMessage] = useState('');
  const [retryCounter, setRetryCounter] = useState(0);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const emailSpeechBufferRef = useRef('');
  const voiceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const listeningStateRef = useRef(false);

  const handleScannerVoice = (text: string) => {
    if (/\b(close|exit|back to wallet|wallet home|band karo|ghar)\b/i.test(text) || /वापस|बंद/.test(text)) {
      scannerVoice.stopListening();
      onReturnHome();
      return;
    }
    if (/\b(scan again|retry|try again|dobara scan)\b/i.test(text) || /फिर से स्कैन/.test(text)) {
      scannerVoice.stopListening();
      setScannerMode('scan');
      setCameraError(null);
      setTimeoutExpired(false);
      setRetryCounter((count) => count + 1);
      const retry = lang === 'hi-IN' ? 'QR scan dobara shuru kar raha hoon.' : 'Restarting the QR scanner.';
      setVoiceMessage(retry);
      speakThenResume(retry);
      return;
    }

    // Once the email form has been submitted, this microphone belongs to the
    // wallet's payment/safety conversation. In particular, "no" is an answer
    // to the safety question, not a malformed email address.
    if (emailSubmitted) {
      void onStartEmailPayment?.(text);
      return;
    }

    const normalized = text.trim().replace(/[,!?;:।]/g, ' ');
    const spokenEmail = normalized
      .replace(/\b(at the rate|at sign|at|ऐट)\b/gi, '@')
      .replace(/\b(dot|period|full stop|डॉट)\b/gi, '.')
      .replace(/\b(underscore|under score)\b/gi, '_')
      .replace(/\b(hyphen|dash)\b/gi, '-')
      .replace(/\s*([@.])\s*/g, '$1')
      .replace(/\s+/g, '');
    const completeEmailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    // Some speech engines split an address into separate results (for example,
    // "vansh at" followed by "gmail dot com"). Keep those fragments only in
    // email mode and join them until we have a complete address.
    const directEmail = spokenEmail.match(completeEmailPattern)?.[0];
    let email: string | undefined = directEmail;
    if (emailEntryOpen && !directEmail) {
      const fragment = spokenEmail.replace(/[^A-Z0-9._%+-@]/gi, '');
      if (fragment) {
        const prior = emailSpeechBufferRef.current;
        const combined = `${prior}${fragment}`;
        emailSpeechBufferRef.current = combined;
        email = combined.match(completeEmailPattern)?.[0];
        if (!email) {
          setRecipientEmail(combined);
          const prompt = lang === 'hi-IN'
            ? 'Email ka hissa suna. Ab at aur domain boliye, jaise gmail dot com.'
            : 'I heard part of the email. Now say “at” and the domain, such as “gmail dot com”.';
          setVoiceMessage(prompt);
          speakThenResume(prompt);
          return;
        }
      }
    }

    if (email) {
      emailSpeechBufferRef.current = email;
      setRecipientEmail(email);
      onEmailEntryOpenChange?.(true);
      const [localPart, domainPart] = email.split('@');
      const spelledDomain = domainPart.split('').join(' ');
      const confirmation = lang === 'hi-IN'
        ? `Email suna ${localPart} at ${spelledDomain}. Kripya domain dhyan se sunein. Galat ho to neeche edit karein.`
        : `I heard ${localPart} at ${spelledDomain}. Listen to the domain carefully. Edit it below if it is wrong.`;
      setVoiceMessage(confirmation);
      speakThenResume(confirmation);
      return;
    }

    if (/\b(email|e-mail|pay by email|email se)\b/i.test(text) || /ईमेल/.test(text)) {
      onEmailEntryOpenChange?.(true);
      const prompt = lang === 'hi-IN' ? 'PayPal email boliye ya neeche type karein.' : 'Say the recipient’s PayPal email, or type it below.';
      setVoiceMessage(prompt);
      speakThenResume(prompt);
      return;
    }

    if (/\b(scan|scanner|qr|camera)\b/i.test(text) || /स्कैन|कैमरा/.test(text)) {
      setScannerMode('scan');
      const prompt = lang === 'hi-IN' ? 'Theek hai, QR code ko camera ke saamne rakhein.' : 'Okay, hold the QR code in front of the camera.';
      setVoiceMessage(prompt);
      speakThenResume(prompt);
      return;
    }

    if (emailEntryOpen) {
      const prompt = lang === 'hi-IN'
        ? 'ईमेल साफ़ नहीं सुनाई दिया। नाम, at, डोमेन और dot com बोलें, या नीचे टाइप करें।'
        : 'I didn’t catch a complete email. Say the name, “at”, domain, and “dot com”, or type it below.';
      setVoiceMessage(prompt);
      speakThenResume(prompt);
      return;
    }

    const prompt = lang === 'hi-IN' ? 'Main samajh rahi hoon. QR scan karein ya PayPal email se pay karein?' : 'I’m listening. Would you like to scan a QR code or pay by PayPal email?';
    setVoiceMessage(prompt);
    speakThenResume(prompt);
    void onStartEmailPayment?.(text);
  };

  const scannerVoice = useSpeechRecognition({
    // Email addresses are much more reliably recognized with an English model,
    // even when the rest of the app is using Hindi.
    lang: emailEntryOpen ? 'en-IN' : lang,
    preferEmail: emailEntryOpen,
    onResult: handleScannerVoice,
    onError: (code, friendlyMessage) => {
      setVoiceMessage(friendlyMessage);
      if (code === 'no-speech') speakThenResume(friendlyMessage, 500);
      else speak(friendlyMessage, { lang });
    },
  });

  useEffect(() => {
    listeningStateRef.current = scannerVoice.isListening;
  }, [scannerVoice.isListening]);

  useEffect(() => {
    if (!isOpen) return;
    const resumeAfterWalletReply = () => queueListening(350);
    window.addEventListener('awaaz-scanner-speech-ended', resumeAfterWalletReply);
    return () => window.removeEventListener('awaaz-scanner-speech-ended', resumeAfterWalletReply);
  }, [isOpen, scannerVoice.isSupported]);

  const queueListening = (delayMs: number) => {
    if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
    voiceRestartTimerRef.current = setTimeout(() => {
      voiceRestartTimerRef.current = null;
      if (isOpenRef.current && scannerVoice.isSupported && !listeningStateRef.current) scannerVoice.startListening();
    }, delayMs);
  };

  const speakThenResume = (text: string, delayMs = 350) => {
    if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
    scannerVoice.stopListening();
    speak(text, { lang, onEnd: () => queueListening(delayMs) });
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
    speakThenResume(text);
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
            speakThenResume(timeoutMsg);
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
      speakThenResume(errGuidance);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      scannerVoice.stopListening();
      setScannerMode('choice');
      setCameraError(null);
      setTimeoutExpired(false);
      onEmailEntryOpenChange?.(false);
      setRecipientAmount('');
      setEmailSubmitted(false);
      setEmailSubmitError('');
      if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = null;
    }
  }, [isOpen, scannerVoice.stopListening, onEmailEntryOpenChange]);

  useEffect(() => {
    if (!isOpen) return;
    const prompt = lang === 'hi-IN'
      ? 'Aap QR scan karna chahte hain ya PayPal email se pay karna? Bolkar ya neeche button dabakar chunein.'
      : 'Would you like to scan a QR code or pay by PayPal email? Say your choice, or tap an option below.';
    setVoiceMessage(prompt);
    if (!scannerVoice.isSupported) return;

    // Start recognition from the actual end of speech, not a short fixed delay.
    // The old timer could open the mic while the prompt was still speaking.
    let promptFinished = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!promptFinished) queueListening(350);
    }, 12000);
    speakRef.current(prompt, {
      lang,
      onEnd: () => {
        promptFinished = true;
        window.clearTimeout(fallbackTimer);
        queueListening(350);
      },
    });
    return () => {
      promptFinished = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [isOpen, lang, scannerVoice.isSupported, scannerVoice.startListening]);

  useEffect(() => {
    if (emailEntryOpen) {
      emailInputRef.current?.focus();
      emailSpeechBufferRef.current = recipientEmail;
    } else {
      emailSpeechBufferRef.current = '';
    }
  }, [emailEntryOpen, recipientEmail]);

  useEffect(() => {
    if (!isOpen || emailEntryOpen || scannerMode !== 'scan') {
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
  }, [isOpen, cameraCommand, emailEntryOpen, retryCounter, scannerMode]);

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

  const choosingMethod = !emailEntryOpen && scannerMode === 'choice';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a payment method"
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
        <Headline level={1}>
          {emailEntryOpen
            ? (lang === 'hi-IN' ? 'ईमेल से भुगतान करें' : 'Pay by email')
            : choosingMethod
              ? (lang === 'hi-IN' ? 'भुगतान का तरीका चुनें' : 'How would you like to pay?')
              : (lang === 'hi-IN' ? 'QR code scan karein' : 'Scan a QR code')}
        </Headline>
        <BodyText muted style={{ marginTop: '0.5rem', maxWidth: '48ch' }}>
          {emailEntryOpen
            ? (lang === 'hi-IN' ? 'PayPal email boliye ya type karein. Payment se pehle details check kar paayenge.' : 'Say or enter the recipient’s PayPal email. You can review the details before paying.')
            : choosingMethod
              ? (lang === 'hi-IN' ? 'QR code scan karein ya PayPal email se pay karein. Aap bolkar ya button chun kar aage badh sakte hain.' : 'Choose QR scanning or PayPal email. Say your choice or select an option below.')
              : (lang === 'hi-IN' ? 'Invoice ya Awaaz Pay recipient QR ko frame ke andar rakhein.' : 'Place a PayPal invoice or Awaaz Pay recipient QR inside the frame.')}
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
              ? (lang === 'hi-IN' ? 'सुनना रोकें' : 'Listening · Stop')
              : (lang === 'hi-IN' ? 'बोलकर चुनें' : 'Choose by voice')}
        </button>
        {scannerVoice.isListening && (
          <div role="status" aria-live="polite" style={{ marginTop: '0.5rem' }}>
            <BodyText>{lang === 'hi-IN' ? 'सुन रही हूँ। Email se pay, dobara scan, ya scanner band boliye.' : 'Listening. Say “pay by email”, “scan again”, or “close scanner”.'}</BodyText>
          </div>
        )}
        {voiceMessage && !choosingMethod && (
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
        {/* Live scan guidance is shown on the scanner screen, not on the method chooser. */}
        {!emailEntryOpen && !choosingMethod && !cameraError && !timeoutExpired && <div
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

      {choosingMethod && (
        <section aria-label={lang === 'hi-IN' ? 'भुगतान का तरीका' : 'Payment method'} style={{ width: '100%', maxWidth: '560px', display: 'grid', gap: '1rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            onClick={() => {
              setVoiceMessage(lang === 'hi-IN' ? 'QR scanner shuru kar rahi hoon.' : 'Opening the QR scanner.');
              setScannerMode('scan');
              speakThenResume(lang === 'hi-IN' ? 'QR code ko camera ke saamne rakhein.' : 'Hold the QR code in front of the camera.');
            }}
            style={{ minHeight: 104, width: '100%', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '1rem', textAlign: 'left', borderRadius: '20px', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', cursor: 'pointer' }}
          >
            <span aria-hidden="true" style={{ width: 52, height: 52, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '16px', background: 'rgba(255,255,255,0.18)', fontSize: '1.8rem' }}>▦</span>
            <span style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ fontSize: '1.25rem' }}>{lang === 'hi-IN' ? 'QR code scan karein' : 'Scan a QR code'}</strong>
              <span style={{ fontSize: '1rem', fontWeight: 500, opacity: 0.94 }}>{lang === 'hi-IN' ? 'Camera kholkar code scan karein' : 'Open the camera and scan a code'}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onEmailEntryOpenChange?.(true);
              setVoiceMessage(lang === 'hi-IN' ? 'PayPal email boliye ya type karein.' : 'Say or type the recipient’s PayPal email.');
              speakThenResume(lang === 'hi-IN' ? 'PayPal email boliye ya type karein.' : 'Say or type the recipient’s PayPal email.');
            }}
            style={{ minHeight: 104, width: '100%', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '1rem', textAlign: 'left', borderRadius: '20px', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', cursor: 'pointer' }}
          >
            <span aria-hidden="true" style={{ width: 52, height: 52, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '16px', background: 'var(--bg)', fontSize: '1.7rem' }}>@</span>
            <span style={{ display: 'grid', gap: '0.25rem' }}>
              <strong style={{ fontSize: '1.25rem' }}>{lang === 'hi-IN' ? 'PayPal email se pay karein' : 'Pay by PayPal email'}</strong>
              <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}>{lang === 'hi-IN' ? 'Email boliye ya type karein' : 'Say or type the email address'}</span>
            </span>
          </button>
        </section>
      )}

      {/* The camera is requested only after the user chooses QR scanning. */}
      {!emailEntryOpen && !choosingMethod && <main
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

      {!emailEntryOpen && !choosingMethod && (
        <div style={{ width: '100%', maxWidth: '560px', display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={() => { stopCamera(); setCameraError(null); setTimeoutExpired(false); setScannerMode('choice'); }} style={{ minHeight: 64, width: '100%', padding: '0.75rem 1rem', borderRadius: '16px', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
            {lang === 'hi-IN' ? 'भुगतान का तरीका बदलें' : 'Choose another option'}
          </button>
        </div>
      )}

      {emailEntryOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = recipientEmail.trim();
            const amount = Number(recipientAmount);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || (!allowEmailRecipient && (!Number.isFinite(amount) || amount <= 0)) || submittingEmail) return;
            if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current);
            voiceRestartTimerRef.current = null;
            scannerVoice.stopListening();
            setSubmittingEmail(true);
            setEmailSubmitError('');
            Promise.resolve(onUseEmail?.(value, allowEmailRecipient ? undefined : amount))
              .then(() => {
                setEmailSubmitted(true);
                const message = lang === 'hi-IN'
                  ? 'Family approval request bhej di gayi hai. Payment abhi nahi bheji gayi.'
                  : 'Family approval request sent. No payment has been sent.';
                setVoiceMessage(message);
                speak(message, { lang, onEnd: () => undefined });
              })
              .catch((error: unknown) => {
                const message = (error as Error)?.message || 'Could not confirm the family approval request. Check its status before trying again.';
                setEmailSubmitError(message);
                speak(message, { lang, onEnd: () => undefined });
              })
              .finally(() => setSubmittingEmail(false));
          }}
          style={{ width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem', borderRadius: 'var(--radius-card, 16px)', border: '2px solid var(--border)', background: 'var(--surface)' }}
        >
          <BodyText size="large" style={{ fontWeight: 750 }}>{lang === 'hi-IN' ? 'Kisko payment bhejni hai?' : 'Who would you like to pay?'}</BodyText>
          <BodyText muted>
            {allowEmailRecipient
              ? (lang === 'hi-IN' ? 'Recipient ka PayPal Sandbox email boliye ya type karein. Payment bhejne se pehle details review hongi.' : 'Enter the recipient’s PayPal Sandbox email. Review the payment details before sending.')
              : (lang === 'hi-IN' ? 'PayPal email aur USD ki rakam daalein. Is request ko aapki family approve karegi; approval ke bina payment nahi bheji jayegi.' : 'Enter a PayPal email and amount in USD. Your family must approve this request; no payment is sent without their approval.')}
          </BodyText>
          {recipientEmail && (
            <div role="status" aria-live="polite" style={{ padding: '0.9rem 1rem', border: '1px solid var(--warning)', borderRadius: '14px', background: 'var(--bg)', color: 'var(--text)' }}>
              <BodyText>
                {lang === 'hi-IN'
                  ? 'Suni hui email aur khaaskar @ ke baad ka domain jaanch lein. Galat ho to edit karein; hum email ka domain verify nahi kar sakte.'
                  : 'Check the email you heard, especially the domain after @. Edit it if needed; we cannot verify that the domain belongs to the recipient.'}
              </BodyText>
              {recipientEmail && (
                <button
                  type="button"
                  onClick={() => {
                    const [localPart, domainPart = ''] = recipientEmail.split('@');
                    const spelled = `${localPart} at ${domainPart.split('').join(' ')}`;
                    speak(lang === 'hi-IN' ? `Email: ${spelled}` : `Email address: ${spelled}`, { lang });
                  }}
                  style={{ minHeight: 64, marginTop: '0.75rem', padding: '0.65rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}
                >
                  {lang === 'hi-IN' ? 'ईमेल की स्पेलिंग सुनें' : 'Hear email spelling'}
                </button>
              )}
            </div>
          )}
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
            disabled={submittingEmail || emailSubmitted}
            value={recipientEmail}
            onChange={(event) => { setRecipientEmail(event.target.value); emailSpeechBufferRef.current = event.target.value; setEmailSubmitted(false); }}
            placeholder="name@example.com"
            style={{ minHeight: 64, width: '100%', boxSizing: 'border-box', padding: '0.75rem', borderRadius: 'var(--radius-card, 12px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit' }}
          />
          {!allowEmailRecipient && (
            <>
              <label htmlFor="scanner-recipient-amount" style={{ fontWeight: 650 }}>{lang === 'hi-IN' ? 'रकम (USD)' : 'Amount (USD)'}</label>
              <input
                id="scanner-recipient-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                disabled={submittingEmail || emailSubmitted}
                value={recipientAmount}
                onChange={(event) => { setRecipientAmount(event.target.value); setEmailSubmitted(false); }}
                placeholder="0.00"
              />
            </>
          )}
          {emailSubmitted && (
            <div role="status" aria-live="polite" style={{ padding: '0.9rem 1rem', border: '1px solid var(--accent)', borderRadius: '14px', background: 'var(--bg)', color: 'var(--text)' }}>
              <BodyText>
                {lang === 'hi-IN'
                  ? 'Family approval request bhej di gayi hai. Payment abhi nahi bheji gayi. Family ke approve karne par hi payment aage badhegi.'
                  : 'Family approval request sent. No payment has been sent. The payment can proceed only if your family approves it.'}
              </BodyText>
            </div>
          )}
          {emailSubmitError && (
            <div role="alert" aria-live="assertive" style={{ padding: '0.9rem 1rem', border: '1px solid var(--danger)', borderRadius: '14px', background: 'var(--bg)', color: 'var(--text)' }}>
              <BodyText>{emailSubmitError}</BodyText>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button type="submit" disabled={submittingEmail || emailSubmitted} style={{ minHeight: 64, flex: '1 1 170px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)', font: 'inherit', fontWeight: 750, cursor: submittingEmail ? 'wait' : 'pointer', opacity: submittingEmail || emailSubmitted ? 0.7 : 1 }}>
              {submittingEmail ? (lang === 'hi-IN' ? 'Approval request bhej rahe hain…' : 'Sending approval request…') : emailSubmitted ? (lang === 'hi-IN' ? 'Approval ka intezaar' : 'Waiting for approval') : allowEmailRecipient ? (lang === 'hi-IN' ? 'Aage badhein' : 'Continue') : (lang === 'hi-IN' ? 'Family approval maangein' : 'Send to family for approval')}
            </button>
            <button type="button" onClick={() => { setEmailSubmitted(false); onEmailEntryOpenChange?.(false); }} style={{ minHeight: 64, flex: '1 1 140px', padding: '0.7rem 1rem', borderRadius: 'var(--radius-pill, 999px)', border: '2px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', font: 'inherit', fontWeight: 750, cursor: 'pointer' }}>
            {lang === 'hi-IN' ? 'दूसरा तरीका चुनें' : 'Choose another option'}
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
