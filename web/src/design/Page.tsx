import React from 'react';
import './Page.css';

interface PageProps {
  children: React.ReactNode;
  headerContent?: React.ReactNode;
  footerContent?: React.ReactNode;
  className?: string;
  lang?: string;
}

export const Page: React.FC<PageProps> = ({
  children,
  headerContent,
  footerContent,
  className = '',
  lang = 'en',
}) => {
  return (
    <div className={`blind-first-page-layout ${className}`} lang={lang}>
      <a href="#main-content" className="skip-link">
        {lang === 'hi' ? 'मुख्य विषय पर जाएं (Skip to content)' : 'Skip to main content'}
      </a>

      {headerContent && (
        <header className="page-header" role="banner">
          {headerContent}
        </header>
      )}

      <main id="main-content" className="page-main" role="main" tabIndex={-1}>
        {children}
      </main>

      {footerContent && (
        <footer className="page-footer" role="contentinfo">
          {footerContent}
        </footer>
      )}
    </div>
  );
};
