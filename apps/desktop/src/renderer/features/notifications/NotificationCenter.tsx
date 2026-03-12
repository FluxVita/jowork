import { useNotificationStore } from './hooks/useNotifications';

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotificationStore();

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 text-sm bg-accent text-white px-2 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={markAllRead}
              className="text-xs text-text-secondary hover:text-accent transition-colors"
            >
              Mark all read
            </button>
            <button
              onClick={clear}
              className="text-xs text-text-secondary hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          In-app notifications from scheduled tasks and connectors.
        </p>

        {notifications.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            <p>No notifications.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  n.read
                    ? 'bg-surface-1 text-text-secondary'
                    : 'bg-surface-2 border border-border hover:border-accent/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  <span className="text-sm font-medium text-text-primary">{n.title}</span>
                  <span className="text-[10px] text-text-secondary ml-auto">
                    {new Date(n.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">{n.body}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
