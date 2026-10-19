import React, { useRef, useState, useEffect } from 'react';
import {
  Eraser,
  Undo,
  PenTool,
  Eye,
  EyeOff,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface ScratchpadCanvasProps {
  ghostCharacter?: string;
  isOpen: boolean;
  onClose?: () => void;
  className?: string;
  hideGhostGuide?: boolean;
}

export const ScratchpadCanvas: React.FC<ScratchpadCanvasProps> = ({
  ghostCharacter,
  isOpen,
  onClose,
  className = '',
  hideGhostGuide = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [stylusOnly, setStylusOnly] = useState(false); // Can be toggled for palm rejection
  const [showGhostGuide, setShowGhostGuide] = useState(true);
  const [strokeColor, setStrokeColor] = useState('#4f46e5');
  const [lineWidth, setLineWidth] = useState(4);

  // History for Undo
  const strokeHistoryRef = useRef<ImageData[]>([]);

  // Strip bracketed furigana if present in character string
  const cleanGhostString = React.useMemo(() => {
    if (!ghostCharacter) return '';
    return ghostCharacter.replace(/[\(（][^\)）]+[\)）]/g, '').trim();
  }, [ghostCharacter]);

  // Split multi-character words into array of individual glyphs
  const characters = React.useMemo(() => {
    if (!cleanGhostString) return [];
    return Array.from(cleanGhostString).filter((c) => c.trim().length > 0);
  }, [cleanGhostString]);

  const [selectedCharIndex, setSelectedCharIndex] = useState(0);

  // Active single character for the ghost guide and canvas
  const currentChar = characters[selectedCharIndex] || characters[0] || '';

  // Resize canvas to match display size
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    let prevData: ImageData | null = null;
    if (ctx && canvas.width > 0 && canvas.height > 0) {
      try {
        prevData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        // ignore
      }
    }

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (prevData) {
        ctx.putImageData(prevData, 0, 0);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(resizeCanvas, 50);
      window.addEventListener('resize', resizeCanvas);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', resizeCanvas);
      };
    }
  }, [isOpen]);

  // Reset selected character index and clear canvas when target word changes
  useEffect(() => {
    setSelectedCharIndex(0);
    strokeHistoryRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [cleanGhostString]);

  const saveStrokeToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      strokeHistoryRef.current.push(data);
      if (strokeHistoryRef.current.length > 20) {
        strokeHistoryRef.current.shift();
      }
    } catch {
      // ignore
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Stylus Discrimination: if stylusOnly is enabled, reject non-pen touches (palm rejection)
    if (stylusOnly && e.pointerType !== 'pen') {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    saveStrokeToHistory();

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth * (e.pressure > 0 ? e.pressure * 1.5 : 1);
    setIsDrawing(true);
    canvas.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (stylusOnly && e.pointerType !== 'pen') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    saveStrokeToHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas || strokeHistoryRef.current.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const previousState = strokeHistoryRef.current.pop();
    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleSelectChar = (index: number) => {
    if (index >= 0 && index < characters.length) {
      setSelectedCharIndex(index);
    }
  };

  const handleNextChar = () => {
    if (selectedCharIndex < characters.length - 1) {
      handleClear();
      setSelectedCharIndex((prev) => prev + 1);
    }
  };

  const handlePrevChar = () => {
    if (selectedCharIndex > 0) {
      handleClear();
      setSelectedCharIndex((prev) => prev - 1);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`relative rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 shadow-xl flex flex-col ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Scratchpad Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/40 text-xs">
        <div className="flex items-center gap-2">
          {/* Palm Rejection Toggle */}
          <button
            type="button"
            onClick={() => setStylusOnly((prev) => !prev)}
            className={`px-2.5 py-1 rounded-xl border flex items-center gap-1.5 transition-all ${
              stylusOnly
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-300 font-semibold'
                : 'border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            title="Palm Rejection: Accepts stylus/pen touches only"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>{stylusOnly ? 'Stylus Only' : 'Stylus + Touch'}</span>
          </button>

          {/* SVG Ghost Guide Toggle (Only available when not hidden by production mode) */}
          {!hideGhostGuide && currentChar && (
            <button
              type="button"
              onClick={() => setShowGhostGuide((prev) => !prev)}
              className={`px-2.5 py-1 rounded-xl border flex items-center gap-1 transition-all ${
                showGhostGuide
                  ? 'bg-purple-50 border-purple-300 text-purple-700 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-300 font-semibold'
                  : 'border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-100'
              }`}
              title="Toggle SVG Ghost Stroke Guide"
            >
              {showGhostGuide ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>Ghost Guide</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Undo Stroke */}
          <button
            type="button"
            onClick={handleUndo}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Undo Stroke"
          >
            <Undo className="w-3.5 h-3.5" />
          </button>

          {/* Clear Canvas */}
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            title="Clear Scratchpad"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Multi-Character Selector Pill Bar (when word has >1 character) */}
      {characters.length > 1 && (
        <div className="flex items-center justify-between px-4 py-2 bg-indigo-50/70 dark:bg-indigo-950/40 border-b border-indigo-100 dark:border-indigo-900/50 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mr-1 shrink-0">
              Character:
            </span>
            {characters.map((char, idx) => {
              const isActive = idx === selectedCharIndex;
              const displayLabel = hideGhostGuide ? `Char ${idx + 1}` : char;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectChar(idx)}
                  className={`min-w-[32px] h-7 px-2.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center justify-center ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 scale-105'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={hideGhostGuide ? `Practice character slot ${idx + 1}` : `Select character "${char}" (${idx + 1}/${characters.length})`}
                >
                  {displayLabel}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              type="button"
              disabled={selectedCharIndex === 0}
              onClick={handlePrevChar}
              className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-0.5 text-[11px] font-medium transition-colors"
              title="Previous Character (Clears canvas for previous glyph)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Prev</span>
            </button>

            <button
              type="button"
              disabled={selectedCharIndex >= characters.length - 1}
              onClick={handleNextChar}
              className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-0.5 text-[11px] font-medium transition-colors"
              title="Next Character (Clears canvas and advances)"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Drawing Canvas Area with SVG Ghost Guide */}
      <div className="relative flex-1 min-h-[220px] h-[240px] md:h-[280px] w-full flex items-center justify-center overflow-hidden touch-none bg-white dark:bg-gray-900">
        {/* SVG Ghost Guide Overlay (Single active character, only if not hidden by production front) */}
        {!hideGhostGuide && showGhostGuide && currentChar && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 100 100"
              className="w-48 h-48 max-w-full max-h-full opacity-15 dark:opacity-20 stroke-gray-900 dark:stroke-white"
            >
              {/* Center crosshair guide lines */}
              <line x1="50" y1="0" x2="50" y2="100" strokeDasharray="3,3" strokeWidth="0.5" />
              <line x1="0" y1="50" x2="100" y2="50" strokeDasharray="3,3" strokeWidth="0.5" />
              {/* Large single character guide text */}
              <text
                x="50"
                y="55"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="65"
                fontWeight="bold"
                fill="currentColor"
                className="font-serif"
              >
                {currentChar}
              </text>
            </svg>
          </div>
        )}

        {/* Square guide box outline */}
        <div className="absolute inset-0 m-4 border border-dashed border-gray-200 dark:border-gray-800 pointer-events-none rounded-2xl flex items-center justify-center">
          <div className="w-full h-[1px] bg-gray-100 dark:bg-gray-800" />
          <div className="h-full w-[1px] bg-gray-100 dark:bg-gray-800 absolute" />
        </div>

        {/* The Pointer Event Canvas */}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute inset-0 w-full h-full cursor-crosshair z-10 touch-none"
        />
      </div>

      {/* Tip footer */}
      <div className="px-4 py-1.5 bg-gray-50/50 dark:bg-gray-950/30 text-[10px] text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-gray-800">
        <span>Draw with stylus or finger • Palm rejection ready</span>
        {characters.length > 1 && (
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
            Char {selectedCharIndex + 1} of {characters.length}
          </span>
        )}
      </div>
    </div>
  );
};
