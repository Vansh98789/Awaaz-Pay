import React from 'react';

export const App: React.FC = () => {
  return (
    <main
      role="main"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <header>
        <h1
          style={{
            fontSize: '3rem',
            fontWeight: 800,
            letterSpacing: '-0.025em',
            marginBottom: '0.5rem',
            color: '#ffffff',
          }}
        >
          Awaaz Pay
        </h1>
        <p
          style={{
            fontSize: '1.25rem',
            color: '#a1a1aa',
            maxWidth: '32rem',
            lineHeight: 1.5,
          }}
        >
          A voice-first wallet for blind and low-literacy users in India.
        </p>
      </header>
    </main>
  );
};

export default App;
