import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSpeechSynthesisOptions {
  defaultLang?: string;
  defaultSpeed?: number;
  outputMode?: 'voice' | 'screen_reader';
  onEnd?: () => void;
}

export interface UseSpeechSynthesisReturn {
  isSpeaking: boolean;
  speed: number;
  lastSpokenText: string;
  isSupported: boolean;
  outputMode: 'voice' | 'screen_reader';
  setOutputMode: (mode: 'voice' | 'screen_reader') => void;
  speak: (
    text: string,
    options?: { lang?: string; speed?: number; onEnd?: () => void }
  ) => void;
  stop: () => void;
  repeatLastReply: () => void;
  setSpeed: (speed: number) => void;
}

export function useSpeechSynthesis(
  options: UseSpeechSynthesisOptions = {}
): UseSpeechSynthesisReturn {
  const {
    defaultLang = 'en-IN',
    defaultSpeed = 1.0,
    outputMode: initialMode = 'voice',
    onEnd,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speed, setSpeedState] = useState(defaultSpeed);
  const [outputMode, setOutputModeState] = useState<'voice' | 'screen_reader'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('awaaz_output_mode');
      if (saved === 'voice' || saved === 'screen_reader') return saved;
    }
    return initialMode;
  });
  const [lastSpokenText, setLastSpokenText] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const outputModeRef = useRef(outputMode);
  outputModeRef.current = outputMode;

  const setOutputMode = useCallback((mode: 'voice' | 'screen_reader') => {
    setOutputModeState(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('awaaz_output_mode', mode);
    }
  }, []);

  const speedRef = useRef(speed);
  speedRef.current = speed;

  const lastTextRef = useRef(lastSpokenText);
  lastTextRef.current = lastSpokenText;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSupported(false);
      return;
    }

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const selectVoice = useCallback(
    (lang: string): SpeechSynthesisVoice | null => {
      if (voices.length === 0) return null;

      const directMatch = voices.find(
        (v) => v.lang.toLowerCase() === lang.toLowerCase()
      );
      if (directMatch) return directMatch;

      const prefix = lang.split('-')[0].toLowerCase();
      const langMatch = voices.find((v) =>
        v.lang.toLowerCase().startsWith(prefix)
      );
      if (langMatch) return langMatch;

      const englishFallback = voices.find((v) =>
        v.lang.toLowerCase().startsWith('en')
      );
      return englishFallback || voices[0] || null;
    },
    [voices]
  );

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (
      text: string,
      opts: { lang?: string; speed?: number; onEnd?: () => void } = {}
    ) => {
      if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }

      window.speechSynthesis.cancel();

      const langToUse = opts.lang || defaultLang;
      const rateToUse = opts.speed ?? speedRef.current;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langToUse;
      utterance.rate = rateToUse;

      const matchedVoice = selectVoice(langToUse);
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        if (opts.onEnd) {
          opts.onEnd();
        } else if (onEndRef.current) {
          onEndRef.current();
        }
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
      };

      setLastSpokenText(text);

      // In Screen Reader mode, TalkBack/VoiceOver handles reading the live region directly.
      if (outputModeRef.current === 'screen_reader') {
        if (opts.onEnd) {
          opts.onEnd();
        } else if (onEndRef.current) {
          onEndRef.current();
        }
        return;
      }

      window.speechSynthesis.speak(utterance);
    },
    [defaultLang, selectVoice]
  );

  const repeatLastReply = useCallback(() => {
    if (lastTextRef.current) {
      speak(lastTextRef.current);
    }
  }, [speak]);

  const setSpeed = useCallback((newSpeed: number) => {
    const clamped = Math.max(0.5, Math.min(2.0, newSpeed));
    setSpeedState(clamped);
  }, []);

  return {
    isSpeaking,
    speed,
    lastSpokenText,
    isSupported,
    outputMode,
    setOutputMode,
    speak,
    stop,
    repeatLastReply,
    setSpeed,
  };
}
