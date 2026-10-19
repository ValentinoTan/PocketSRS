import 'fake-indexeddb/auto';

// Mock Web Speech API
if (typeof window !== 'undefined') {
  if (!window.speechSynthesis) {
    window.speechSynthesis = {
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      onvoiceschanged: null,
      paused: false,
      pending: false,
      speaking: false,
    } as any;
  }

  // Mock window.matchMedia
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // Mock navigator.vibrate
  if (!navigator.vibrate) {
    navigator.vibrate = () => true;
  }

  // Mock URL.createObjectURL and revokeObjectURL
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:mock-url';
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => {};
  }
}
