import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SpeechRecognitionInstance,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from '../types/speech.d.ts';
import { triggerHaptic } from './useHaptics.js';

let listeningAudioContext: AudioContext | null = null;

function playListeningCue(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    listeningAudioContext ??= new window.AudioContext();
    const context = listeningAudioContext;
    const play = () => {
      const startAt = context.currentTime;
      // Two soft rising notes give a clear, short signal that the microphone
      // has opened, including when it resumes hands-free after the assistant.
      for (const [frequency, offset] of [[660, 0], [880, 0.12]] as const) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt + offset);
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.055, startAt + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.085);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.09);
      }
    };
    if (context.state === 'suspended') void context.resume().then(play).catch(() => undefined);
    else play();
  } catch {
    // Haptic and visible listening states remain available if audio is blocked.
  }
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  finalizeDelayMs?: number;
  preferEmail?: boolean;
  preferConfirmation?: boolean;
  onResult?: (text: string) => void;
  onError?: (error: string, friendlyMsg: string) => void;
}

export interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const { lang = 'hi-IN', continuous = false, finalizeDelayMs = 1800, preferEmail = false, preferConfirmation = false, onResult, onError } = options;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const langRef = useRef(lang);
  const preferEmailRef = useRef(preferEmail);
  const preferConfirmationRef = useRef(preferConfirmation);
  const continuousRef = useRef(continuous);
  const finalizeDelayRef = useRef(finalizeDelayMs);
  const pendingFinalRef = useRef('');
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
    langRef.current = lang;
    preferEmailRef.current = preferEmail;
    preferConfirmationRef.current = preferConfirmation;
    continuousRef.current = continuous;
    finalizeDelayRef.current = finalizeDelayMs;
  }, [onResult, onError, lang, preferEmail, preferConfirmation, continuous, finalizeDelayMs]);

  const createRecognition = useCallback(() => {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      return null;
    }

    // Clean up existing instance safely
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = continuousRef.current;
    recognition.interimResults = true;
    recognition.maxAlternatives = preferEmailRef.current || preferConfirmationRef.current ? 5 : 1;
    recognition.lang = langRef.current;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      triggerHaptic('listeningStart');
      playListeningCue();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const result = event.results[i];
          let chosenTranscript = result[0].transcript;
          if (preferEmailRef.current) {
            for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex++) {
              const candidate = result[alternativeIndex].transcript;
              if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(candidate)) {
                chosenTranscript = candidate;
                break;
              }
            }
          } else if (preferConfirmationRef.current) {
            for (let alternativeIndex = 0; alternativeIndex < result.length; alternativeIndex++) {
              const candidate = result[alternativeIndex].transcript;
              if (/\b(?:yes|yeah|yep|yup|no|nope|nah|haan|han|nahi|nahin|हाँ|हां|नहीं|नही)\b/i.test(candidate)) {
                chosenTranscript = candidate;
                break;
              }
            }
          }
          finalTranscript += chosenTranscript;
        } else {
          setTranscript(event.results[i][0].transcript);
        }
      }

      if (finalTranscript.trim()) {
        const clean = finalTranscript.trim();
        setTranscript(clean);
        triggerHaptic('understood');
        if (continuousRef.current) {
          pendingFinalRef.current = [pendingFinalRef.current, clean].filter(Boolean).join(' ').trim();
          if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
          finalizeTimerRef.current = setTimeout(() => {
            finalizeTimerRef.current = null;
            const completeUtterance = pendingFinalRef.current.trim();
            pendingFinalRef.current = '';
            if (!completeUtterance) return;
            try { recognition.stop(); } catch { /* Recognition may already have stopped. */ }
            onResultRef.current?.(completeUtterance);
          }, finalizeDelayRef.current);
        } else if (onResultRef.current) {
          onResultRef.current(clean);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[SpeechRecognition] error encountered:', event.error, event);
      setIsListening(false);

      // 'aborted' is benign — triggered when stopping, restarting, or tab blur
      if (event.error === 'aborted') {
        return;
      }

      triggerHaptic('error');

      const isHi = langRef.current.startsWith('hi');
      let friendly = '';

      switch (event.error) {
        case 'no-speech':
          friendly = isHi
            ? 'कोई आवाज़ नहीं सुनी गई। कृपया माइक दबाकर दोबारा बोलें।'
            : 'No speech detected. Please tap the mic and speak again.';
          break;

        case 'not-allowed':
          friendly = isHi
            ? 'माइक्रोफ़ोन की अनुमति नहीं मिली। कृपया ब्राउज़र एड्रेस बार में माइक्रोफ़ोन की अनुमति (Allow) दें।'
            : 'Microphone permission was denied. Please allow microphone access in your browser address bar.';
          break;

        case 'service-not-allowed':
          friendly = isHi
            ? 'इस ब्राउज़र में स्पीच रिकग्निशन सेवा बंद है। कृपया Google Chrome या Microsoft Edge का उपयोग करें।'
            : 'Speech recognition service is disabled or blocked in this browser (e.g. Brave blocks Google Speech by default). Please use Chrome or Edge.';
          break;

        case 'network':
          friendly = isHi
            ? 'स्पीच रिकग्निशन में नेटवर्क समस्या है। यदि आप Brave ब्राउज़र में हैं, तो कृपया Chrome या Edge का उपयोग करें, या इंटरनेट कनेक्शन चेक करें।'
            : 'Network error with speech recognition. If you are using Brave browser, it blocks Google speech servers by default — please open the app in Chrome or Edge.';
          break;

        case 'audio-capture':
          friendly = isHi
            ? 'माइक्रोफ़ोन नहीं मिला या काम नहीं कर रहा है। कृपया माइक्रोफ़ोन कनेक्ट करें।'
            : 'No microphone was found or microphone is not working. Please check your mic connection.';
          break;

        case 'language-not-supported':
          friendly = isHi
            ? 'यह भाषा इस ब्राउज़र में समर्थित नहीं है।'
            : 'Selected language is not supported by your browser.';
          break;

        default:
          friendly = isHi
            ? `स्पीच में समस्या आई (${event.error})। कृपया दोबारा कोशिश करें या Chrome/Edge का उपयोग करें।`
            : `Speech recognition error (${event.error}). Please try again or use Chrome/Edge.`;
          break;
      }

      setError(friendly);
      if (onErrorRef.current) {
        onErrorRef.current(event.error, friendly);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    return recognition;
  }, []);

  useEffect(() => {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    return () => {
      if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
      pendingFinalRef.current = '';
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = null;
    pendingFinalRef.current = '';
    setError(null);
    setTranscript('');
    try {
      const recognition = createRecognition();
      if (!recognition) return;
      recognition.start();
    } catch (err) {
      console.warn('[SpeechRecognition] Failed to start:', err);
      const startError = err as Error & { name?: string };
      const friendly = startError.name === 'NotAllowedError'
        ? 'Microphone permission is blocked. Allow microphone access in your browser site settings.'
        : 'Voice recognition could not start. Check your microphone, internet connection, and browser support.';
      setIsListening(false);
      setError(friendly);
      triggerHaptic('error');
      const code = startError.name === 'NotAllowedError'
        ? 'not-allowed'
        : startError.name === 'InvalidStateError'
          ? 'invalid-state'
          : 'start-failed';
      onErrorRef.current?.(code, friendly);
    }
  }, [createRecognition]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {
      // Already stopped
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    transcript,
    error,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
}
