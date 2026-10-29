/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechSynthesis } from '../src/hooks/useSpeechSynthesis.js';
import { useSpeechRecognition } from '../src/hooks/useSpeechRecognition.js';

describe('useSpeechSynthesis', () => {
  let mockSpeak: ReturnType<typeof vi.fn>;
  let mockCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpeak = vi.fn();
    mockCancel = vi.fn();

    const mockVoices = [
      { name: 'Google Hindi', lang: 'hi-IN', default: true } as SpeechSynthesisVoice,
      { name: 'Google English', lang: 'en-US', default: false } as SpeechSynthesisVoice,
    ];

    Object.defineProperty(window, 'speechSynthesis', {
      writable: true,
      value: {
        speak: mockSpeak,
        cancel: mockCancel,
        getVoices: vi.fn().mockReturnValue(mockVoices),
        onvoiceschanged: null,
      },
    });

    globalThis.SpeechSynthesisUtterance = vi.fn().mockImplementation((text?: string) => ({
      text: text || '',
      lang: 'hi-IN',
      rate: 1.0,
      pitch: 1.0,
      voice: null,
      onstart: null,
      onend: null,
      onerror: null,
    })) as unknown as typeof SpeechSynthesisUtterance;
  });

  it('detects synthesis support and speaks with preferred Hindi voice', () => {
    const { result } = renderHook(() =>
      useSpeechSynthesis({ defaultLang: 'hi-IN' })
    );

    expect(result.current.isSupported).toBe(true);

    act(() => {
      result.current.speak('Namaste');
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(result.current.lastSpokenText).toBe('Namaste');
  });

  it('cancels speech on stop', () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => {
      result.current.speak('Paisa bhejo');
    });

    act(() => {
      result.current.stop();
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('repeats last reply when requested', () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => {
      result.current.speak('Ramesh ne 500 rupaye bheje');
    });

    act(() => {
      result.current.repeatLastReply();
    });

    expect(mockSpeak).toHaveBeenCalledTimes(2);
  });

  it('adjusts and clamps speech rate', () => {
    const { result } = renderHook(() => useSpeechSynthesis({ defaultSpeed: 1.0 }));

    act(() => {
      result.current.setSpeed(0.8);
    });
    expect(result.current.speed).toBe(0.8);

    act(() => {
      result.current.setSpeed(5.0);
    });
    expect(result.current.speed).toBe(2.0);
  });
});

describe('useSpeechRecognition', () => {
  it('detects when Web Speech API is missing', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(false);
  });

  it('initializes speech recognition and starts listening', () => {
    let mockInstance: unknown;

    const MockRecognition = vi.fn().mockImplementation(() => {
      const inst = {
        lang: 'hi-IN',
        continuous: false,
        interimResults: true,
        maxAlternatives: 1,
        start: vi.fn().mockImplementation(() => {
          if (inst.onstart) inst.onstart(new Event('start'));
        }),
        stop: vi.fn().mockImplementation(() => {
          if (inst.onend) inst.onend(new Event('end'));
        }),
        abort: vi.fn(),
        onstart: null as ((ev: Event) => void) | null,
        onend: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onresult: null as ((ev: Event) => void) | null,
      };
      mockInstance = inst;
      return inst;
    });

    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockRecognition;

    const { result } = renderHook(() => useSpeechRecognition({ lang: 'hi-IN' }));
    expect(result.current.isSupported).toBe(true);

    act(() => {
      result.current.startListening();
    });

    expect(result.current.isListening).toBe(true);
    expect(mockInstance).toBeDefined();

    act(() => {
      result.current.stopListening();
    });

    expect(result.current.isListening).toBe(false);
  });
});
