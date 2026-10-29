import React, { useState } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';

interface TranscriptEntry {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
}

export const App: React.FC = () => {
  const [lang, setLang] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text:
        lang === 'hi-IN'
          ? 'Namaste Meena ji. Boliye, main sun rahi hoon.'
          : 'Hello Meena. Tap the mic and speak, I am listening.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const { speak, stop, repeatLastReply, isSpeaking, speed, setSpeed } =
    useSpeechSynthesis({
      defaultLang: lang,
      defaultSpeed: 1.0,
    });

  const handleSpeechResult = (text: string) => {
    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const userEntry: TranscriptEntry = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      time: nowTime,
    };

    const echoText =
      lang === 'hi-IN'
        ? `Aapne kaha: "${text}".`
        : `You said: "${text}".`;

    const assistantEntry: TranscriptEntry = {
      id: `a-${Date.now()}`,
      sender: 'assistant',
      text: echoText,
      time: nowTime,
    };

    setTranscripts((prev) => [...prev, userEntry, assistantEntry]);
    speak(echoText, { lang });
  };

  const handleSpeechError = (_code: string, friendlyMsg: string) => {
    speak(friendlyMsg, { lang });
  };

  const { isListening, isSupported: sttSupported, toggleListening, error } =
    useSpeechRecognition({
      lang,
      onResult: handleSpeechResult,
      onError: handleSpeechError,
    });

  const toggleLanguage = () => {
    const nextLang = lang === 'hi-IN' ? 'en-IN' : 'hi-IN';
    setLang(nextLang);
    const switchMsg =
      nextLang === 'hi-IN'
        ? 'Bhasha Hindi chuni gayi.'
        : 'Language switched to English.';
    speak(switchMsg, { lang: nextLang });
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Awaaz Pay</h1>
        <div className="header-controls">
          <button
            type="button"
            className="lang-toggle-btn"
            onClick={toggleLanguage}
            aria-label={`Change language. Currently ${lang === 'hi-IN' ? 'Hindi' : 'English'}`}
          >
            {lang === 'hi-IN' ? '🌐 English' : '🌐 हिंदी'}
          </button>
        </div>
      </header>

      <div
        className="status-bar"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isListening ? (
          <span className="status-badge listening">
            🔴 {lang === 'hi-IN' ? 'Sun rahi hoon... Boliye' : 'Listening... Speak now'}
          </span>
        ) : isSpeaking ? (
          <span className="status-badge speaking">
            🔊 {lang === 'hi-IN' ? 'Bol rahi hoon...' : 'Speaking...'}
          </span>
        ) : (
          <span className="status-badge idle">
            {lang === 'hi-IN' ? 'Taiyaar — Mic dabaiye' : 'Ready — Tap mic to talk'}
          </span>
        )}
      </div>

      <main className="mic-hero-section">
        {!sttSupported ? (
          <div className="unsupported-warning" role="alert">
            <p>
              {lang === 'hi-IN'
                ? 'Aapke browser mein Speech Recognition support nahi hai. Chrome ya Edge use karein.'
                : 'Web Speech API is not supported in this browser. Please use Chrome or Edge.'}
            </p>
          </div>
        ) : (
          <button
            type="button"
            className={`giant-mic-button ${isListening ? 'active' : ''} ${isSpeaking ? 'speaking-active' : ''}`}
            onClick={toggleListening}
            aria-label={
              isListening
                ? lang === 'hi-IN'
                  ? 'Sunna band karein'
                  : 'Stop listening'
                : lang === 'hi-IN'
                  ? 'Bolne ke liye yahan dabayein'
                  : 'Tap to speak'
            }
          >
            <div className="mic-icon-wrapper">
              <svg
                className="mic-svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <span className="mic-hint-text">
              {isListening
                ? lang === 'hi-IN'
                  ? 'Rukne ke liye dabayein'
                  : 'Tap to Stop'
                : lang === 'hi-IN'
                  ? 'Bolne ke liye dabayein'
                  : 'Tap to Speak'}
            </span>
          </button>
        )}

        {error && (
          <p className="error-banner" role="alert">
            ⚠️ {error}
          </p>
        )}
      </main>

      <section className="audio-actions-bar" aria-label="Audio controls">
        <button
          type="button"
          className="action-pill-btn repeat-btn"
          onClick={repeatLastReply}
          aria-label={lang === 'hi-IN' ? 'Pichla jawab dohrao' : 'Repeat last reply'}
        >
          🔁 {lang === 'hi-IN' ? 'Dohrao' : 'Repeat'}
        </button>

        <button
          type="button"
          className="action-pill-btn stop-btn"
          onClick={stop}
          disabled={!isSpeaking}
          aria-label={lang === 'hi-IN' ? 'Awaaz roko' : 'Stop audio'}
        >
          ⏹ {lang === 'hi-IN' ? 'Ruko' : 'Stop'}
        </button>

        <div className="speed-selector" aria-label="Speech speed">
          <button
            type="button"
            className={`speed-chip ${speed === 0.8 ? 'selected' : ''}`}
            onClick={() => setSpeed(0.8)}
            aria-label="Slow speech 0.8x"
          >
            0.8x
          </button>
          <button
            type="button"
            className={`speed-chip ${speed === 1.0 ? 'selected' : ''}`}
            onClick={() => setSpeed(1.0)}
            aria-label="Normal speech 1.0x"
          >
            1.0x
          </button>
          <button
            type="button"
            className={`speed-chip ${speed === 1.2 ? 'selected' : ''}`}
            onClick={() => setSpeed(1.2)}
            aria-label="Fast speech 1.2x"
          >
            1.2x
          </button>
        </div>
      </section>

      <section
        className="transcript-region"
        role="region"
        aria-live="polite"
        aria-label="Transcript of conversation"
      >
        <h2 className="transcript-heading">
          {lang === 'hi-IN' ? 'Baat-cheet (Transcript)' : 'Conversation Transcript'}
        </h2>
        <div className="transcript-scroll">
          {transcripts.map((entry) => (
            <div
              key={entry.id}
              className={`transcript-bubble ${entry.sender}`}
            >
              <div className="bubble-header">
                <span className="bubble-sender">
                  {entry.sender === 'user'
                    ? lang === 'hi-IN'
                      ? 'Aap (User)'
                      : 'You'
                    : 'Awaaz Pay'}
                </span>
                <span className="bubble-time">{entry.time}</span>
              </div>
              <p className="bubble-text">{entry.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default App;
