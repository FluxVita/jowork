interface ConnectorDetailProps {
  connectorId: string;
  name: string;
  status: string;
}

export function ConnectorDetail({ connectorId, name, status }: ConnectorDetailProps) {
  return (
    <div className="p-4">
      <h2 className="font-medium text-sm mb-2">{name}</h2>
      <p className="text-xs text-text-secondary mb-4">Status: {status}</p>

      <div className="space-y-3">
        <section>
          <h3 className="text-xs font-medium text-text-secondary mb-1">Synced Data</h3>
          <p className="text-xs text-text-secondary">No data synced yet.</p>
        </section>

        <section>
          <h3 className="text-xs font-medium text-text-secondary mb-1">Sync Log</h3>
          <p className="text-xs text-text-secondary">No sync activity.</p>
        </section>
      </div>
    </div>
  );
}
