import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
}

export const GlassCard = ({ children, className = '' }: GlassCardProps) => {
  return (
    <div className={`glass-effect backdrop-blur-xl rounded-2xl border border-border overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 ${className}`}>
      {children}
    </div>
  );
};
