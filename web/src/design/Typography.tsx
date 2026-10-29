import React from 'react';

interface HeadlineProps {
  level?: 1 | 2 | 3;
  children: React.ReactNode;
  className?: string;
  lang?: string;
  id?: string;
}

export const Headline: React.FC<HeadlineProps> = ({
  level = 1,
  children,
  className = '',
  lang,
  id,
}) => {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  const sizeClass = level === 1 ? 'headline-h1' : level === 2 ? 'headline-h2' : 'headline-h3';

  return (
    <Tag
      id={id}
      lang={lang}
      className={`app-headline ${sizeClass} ${className}`}
      style={{
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        lineHeight: 1.25,
        color: 'var(--text)',
        fontSize: level === 1 ? 'var(--text-headline-large, 2.75rem)' : 'var(--text-headline, 2.25rem)',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </Tag>
  );
};

interface BodyTextProps {
  size?: 'standard' | 'large';
  muted?: boolean;
  children: React.ReactNode;
  className?: string;
  lang?: string;
  style?: React.CSSProperties;
}

export const BodyText: React.FC<BodyTextProps> = ({
  size = 'standard',
  muted = false,
  children,
  className = '',
  lang,
  style = {},
}) => {
  return (
    <p
      lang={lang}
      className={`app-body-text ${size} ${muted ? 'muted' : ''} ${className}`}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: size === 'large' ? 'var(--text-body-large, 1.5rem)' : 'var(--text-body, 1.25rem)',
        fontWeight: 500,
        lineHeight: 'var(--line-height, 1.4)',
        color: muted ? 'var(--text-muted)' : 'var(--text)',
        ...style,
      }}
    >
      {children}
    </p>
  );
};
