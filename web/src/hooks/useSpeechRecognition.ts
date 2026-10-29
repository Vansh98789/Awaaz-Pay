import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SpeechRecognitionInstance,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from '../types/speech.d.ts';

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

function triggerHaptic(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore environments where vibration is unsupported or blocked
  }
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

  useEffect(() => {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      triggerHaptic([50]);
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
        triggerHaptic([40, 60, 40]);
        if (onResultRef.current) {
          onResultRef.current(clean);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      triggerHaptic([100, 50, 100]);

      let friendly = 'Kuch gadbad hui. Dobara koshish karein.';
      if (langRef.current.startsWith('en')) {
        friendly = 'Something went wrong. Please try again.';
      }

      if (event.error === 'no-speech') {
        friendly =
          langRef.current.startsWith('hi')
            ? 'Koi aawaz nahi suni gayi. Dobara boliye.'
            : 'No speech detected. Please tap and speak again.';
      } else if (
        event.error === 'not-allowed' ||
        event.error === 'service-not-allowed'
      ) {
        friendly =
          langRef.current.startsWith('hi')
            ? 'Microphone ki permission nahi mili. Kripya microphone access allow karein.'
            : 'Microphone permission denied. Please allow microphone access in your browser settings.';
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

    return () => {
      try {
        recognition.abort();
      } catch {
        // Recognition already closed
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    setTranscript('');
    try {
      recognitionRef.current.lang = langRef.current;
      recognitionRef.current.start();
    } catch {
      try {
        recognitionRef.current.abort();
        recognitionRef.current.start();
      } catch {
        // Ignore duplicate start errors
      }
    }
  }, []);

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
