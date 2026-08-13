// First-run gate: who is using this browser. Stands in for real accounts
// until Supabase auth lands.

import { useState } from 'react';
import type { PoolProfile } from '../pool/types';
import { newPlayerId } from '../pool/store';

interface PoolSetupProps {
  onDone: (profile: PoolProfile) => void;
}

export function PoolSetup({ onDone }: PoolSetupProps) {
  const [name, setName] = useState('');
  const [isCommissioner, setIsCommissioner] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onDone({ playerId: newPlayerId(), playerName: trimmed, isCommissioner });
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">🏈</div>
        <h1 className="setup-title">Welcome to the pool</h1>
        <p className="setup-sub">
          Pick 12 games against the spread each week. Spreads lock Monday, one point per game,
          and the GameDay score guess breaks ties.
        </p>
        <input
          className="setup-input"
          placeholder="Your name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        <label className="setup-check">
          <input
            type="checkbox"
            checked={isCommissioner}
            onChange={(e) => setIsCommissioner(e.target.checked)}
          />
          I run this pool (commissioner)
        </label>
        <button type="button" className="submit-btn setup-btn" disabled={!name.trim()} onClick={submit}>
          Let’s go
        </button>
      </div>
    </div>
  );
}
