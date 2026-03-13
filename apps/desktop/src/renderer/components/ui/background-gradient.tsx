/**
 * Decorative background gradient for onboarding and launcher screens.
 * Pure CSS — no external dependencies, works offline.
 */
export const BackgroundGradient = () => {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-[-1] opacity-20"
      aria-hidden="true"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 120%, var(--color-accent, #5856d6) 0%, transparent 70%), ' +
          'radial-gradient(ellipse 60% 40% at 20% 80%, rgba(99, 102, 241, 0.3) 0%, transparent 60%), ' +
          'radial-gradient(ellipse 50% 30% at 80% 90%, rgba(139, 92, 246, 0.2) 0%, transparent 50%)',
      }}
    />
  );
};
