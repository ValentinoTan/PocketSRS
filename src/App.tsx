import React, { useState, useEffect } from 'react';
import { initializeDatabase, db } from './storage/db';
import { DeckTree } from './components/DeckTree';
import { StudyCanvas } from './components/StudyCanvas';
import { CardBrowser } from './components/CardBrowser';
import { SettingsModal } from './components/SettingsModal';
import { SyncModal } from './components/SyncModal';
import { GuideModal } from './components/GuideModal';
import { StudyPlannerModal } from './components/StudyPlanner';
import { WebKitGuardBanner } from './components/WebKitGuardBanner';
import { type StudyMode } from './engine/fsrs';

export function App() {
  const [currentView, setCurrentView] = useState<'tree' | 'study' | 'browser'>('tree');
  const [activeDeckIds, setActiveDeckIds] = useState<string[]>([]);
  const [activeDeckName, setActiveDeckName] = useState<string>('');
  const [activeStudyMode, setActiveStudyMode] = useState<StudyMode>('standard');
  const [activeLanguage, setActiveLanguage] = useState<string>('ja-JP');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSyncOpen, setIsSyncOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark' | 'oled'>('light');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initializeDatabase().then(async () => {
      const settings = await db.settings.get('global');
      if (settings?.theme) {
        applyTheme(settings.theme);
      }
      setDbReady(true);
    });

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setIsGuideOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const applyTheme = (theme: 'light' | 'dark' | 'oled') => {
    setCurrentTheme(theme);
    const root = document.documentElement;
    root.classList.remove('dark', 'oled');
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'oled') {
      root.classList.add('dark', 'oled');
    }
  };

  const handleStartStudy = (
    deckIds: string[],
    deckName: string,
    mode: StudyMode,
    language: string
  ) => {
    setActiveDeckIds(deckIds);
    setActiveDeckName(deckName);
    setActiveStudyMode(mode);
    setActiveLanguage(language || 'ja-JP');
    setCurrentView('study');
  };

  if (!dbReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-700 dark:text-gray-300">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-sm font-medium">Initializing PocketSRS Local Engine...</p>
      </div>
    );
  }

  return (
    <div className={`h-screen h-[100dvh] flex flex-col font-sans overflow-hidden ${currentTheme === 'oled' ? 'oled' : ''}`}>
      <WebKitGuardBanner />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {currentView === 'tree' && (
          <DeckTree
            onStartStudy={handleStartStudy}
            onOpenCardBrowser={() => setCurrentView('browser')}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenSync={() => setIsSyncOpen(true)}
            onOpenGuide={() => setIsGuideOpen(true)}
            onOpenPlanner={() => setIsPlannerOpen(true)}
          />
        )}

        {currentView === 'study' && (
          <StudyCanvas
            deckIds={activeDeckIds}
            deckName={activeDeckName}
            studyMode={activeStudyMode}
            language={activeLanguage}
            onExit={() => setCurrentView('tree')}
          />
        )}

        {currentView === 'browser' && (
          <CardBrowser
            onBackToTree={() => setCurrentView('tree')}
            onSelectDeckForStudy={(deckId) => {
              handleStartStudy([deckId], 'Deck Study', 'standard', 'ja-JP');
            }}
          />
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={applyTheme}
      />

      <SyncModal
        isOpen={isSyncOpen}
        onClose={() => setIsSyncOpen(false)}
      />

      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />

      <StudyPlannerModal
        isOpen={isPlannerOpen}
        onClose={() => setIsPlannerOpen(false)}
        onOpenDeck={(deckId) => {
          setIsPlannerOpen(false);
          handleStartStudy([deckId], 'Deck Study', 'standard', 'ja-JP');
        }}
      />
    </div>
  );
}

export default App;
