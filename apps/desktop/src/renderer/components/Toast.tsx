import { useToastStore, type ToastType } from '../stores/toast';
import { useTranslation } from 'react-i18next';

const ICONS: Record<ToastType, string> = {
  info: 'ℹ️',
  success: '✓',
  warning: '⚠️',
  error: '✗',
};

const STYLES: Record<ToastType, string> = {
  info: 'border-accent/30 bg-accent/5',
  success: 'border-green-400/30 bg-green-400/5',
  warning: 'border-yellow-400/30 bg-yellow-400/5',
  error: 'border-red-400/30 bg-red-400/5',
};

const ICON_STYLES: Record<ToastType, string> = {
  info: 'text-accent',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

export function ToastContainer() {
  const { t } = useTranslation('common');
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border shadow-lg backdrop-blur-sm
            animate-[slideIn_0.2s_ease-out] ${STYLES[toast.type]}`}
        >
          <span className={`text-sm shrink-0 ${ICON_STYLES[toast.type]}`}>
            {ICONS[toast.type]}
          </span>
          <p className="text-sm text-text-primary flex-1">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            aria-label={t('dismissNotification')}
            className="text-text-secondary hover:text-text-primary text-xs shrink-0 ml-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
