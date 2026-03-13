import { useToastStore, type ToastType } from '../stores/toast';
import { useTranslation } from 'react-i18next';

const STYLES: Record<ToastType, string> = {
  info: 'border-accent/20',
  success: 'border-green-500/20',
  warning: 'border-yellow-500/20',
  error: 'border-red-500/20',
};

const DOT_STYLES: Record<ToastType, string> = {
  info: 'bg-accent',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
};

export function ToastContainer() {
  const { t } = useTranslation('common');
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`glass flex items-start gap-2.5 px-3.5 py-3 rounded-xl border
            animate-[slideIn_0.3s_cubic-bezier(0.2,0.8,0.2,1)] ${STYLES[toast.type]}`}
        >
          <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${DOT_STYLES[toast.type]}`} />
          <p className="text-[13px] text-text-primary flex-1 leading-snug">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            aria-label={t('dismissNotification')}
            className="text-text-secondary/60 hover:text-text-primary text-xs flex-shrink-0 ml-1 transition-colors duration-150"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
