import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SpeechRecognitionInstance,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from '../types/speech.d.ts';
import { triggerHaptic } from './useHaptics.js';

export interface UseSpeechRecognitionOptions {
  lang?: string;
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
  const { lang = 'hi-IN', onResult, onError } = options;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const langRef = useRef(lang);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
    langRef.current = lang;
  }, [onResult, onError, lang]);

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
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = langRef.current;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      triggerHaptic('listeningStart');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          setTranscript(event.results[i][0].transcript);
        }
      }

      if (finalTranscript.trim()) {
        const clean = finalTranscript.trim();
        setTranscript(clean);
        triggerHaptic('understood');
        if (onResultRef.current) {
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
