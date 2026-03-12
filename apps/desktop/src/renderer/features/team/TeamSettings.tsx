import { useState } from 'react';
import type { Team } from './hooks/useTeam';

interface TeamSettingsProps {
  team: Team;
}

export function TeamSettings({ team }: TeamSettingsProps) {
  const [name, setName] = useState(team.name);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await window.jowork.invoke('team:update-settings', team.id, { name });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-surface rounded-lg p-5">
      <h3 className="font-medium mb-4">Team Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-text-secondary block mb-1">Team Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-sm text-text-secondary block mb-1">Team ID</label>
          <input
            readOnly
            value={team.id}
            className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-secondary outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Save
          </button>
          {saved && <span className="text-xs text-accent">Saved!</span>}
        </div>
      </div>
    </div>
  );
}
