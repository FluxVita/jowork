import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from './hooks/useNotifications';
import { NotificationRules } from './NotificationRules';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';

type Tab = 'inbox' | 'rules';

export function NotificationCenter() {
  const { t } = useTranslation('notifications');
  const { notifications, unreadCount, markRead, markAllRead, clear, loadNotifications } = useNotificationStore();
  const [tab, setTab] = useState<Tab>('inbox');

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="relative p-2.5 rounded-xl bg-primary/10 text-primary">
              <Bell className="w-6 h-6" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 items-center justify-center text-[9px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {tab === 'inbox' && notifications.length > 0 && (
              <>
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                >
                  <CheckCheck className="w-4 h-4" />
                  {t('markAllRead')}
                </button>
                <button
                  onClick={clear}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('clearAll')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 mb-8 border-b border-border/40">
          {(['inbox', 'rules'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`pb-3 text-[15px] font-semibold transition-all border-b-2 -mb-px px-1 ${
                tab === tabKey
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(tabKey)}
            </button>
          ))}
        </div>

        {tab === 'rules' ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <NotificationRules />
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-20 glass-effect rounded-2xl border border-dashed border-border/50 animate-in fade-in duration-500">
             <Bell className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-[15px] text-foreground font-medium">{t('noNotifications')}</p>
          </div>
        ) : (
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`w-full text-left p-4 rounded-xl transition-all duration-300 ${
                  n.read
                    ? 'bg-surface-1/40 text-muted-foreground border border-transparent'
                    : 'glass-effect border-primary/20 shadow-md shadow-primary/5 hover:border-primary/40 group'
                }`}
              >
                <div className="flex items-start gap-3 mb-1.5">
                  {!n.read && (
                    <div className="mt-1.5 flex-shrink-0">
                      <span className="block w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className={`text-[15px] font-semibold truncate ${n.read ? 'text-muted-foreground' : 'text-foreground group-hover:text-primary transition-colors'}`}>
                        {n.title}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground/70 whitespace-nowrap">
                        {new Date(n.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className={`text-[13px] line-clamp-2 leading-relaxed ${n.read ? 'text-muted-foreground/60' : 'text-muted-foreground/90'}`}>
                      {n.body}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}