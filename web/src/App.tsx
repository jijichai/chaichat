import { useEffect, useState } from 'react';
import { useApp } from './store';
import { BootScreen } from './components/BootScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LandingScreen } from './components/LandingScreen';
import { ChatShell } from './components/ChatShell';
import { RestoreScreen } from './components/RestoreScreen';

export default function App() {
  const phase = useApp((s) => s.phase);
  const boot = useApp((s) => s.boot);
  const [showRestore, setShowRestore] = useState(false);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (phase === 'landing') {
    return <LandingScreen />;
  }

  if (phase === 'welcome') {
    if (showRestore) {
      return <RestoreScreen onBack={() => setShowRestore(false)} />;
    }
    return <WelcomeScreen onRestore={() => setShowRestore(true)} />;
  }

  if (phase === 'connecting' || phase === 'ready') {
    return <ChatShell />;
  }

  return <BootScreen />;
}
