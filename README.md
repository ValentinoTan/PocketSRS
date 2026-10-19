# PocketSRS 🎴

> **Hierarchical Spaced Repetition Engine (FSRS-6) Progressive Web App** featuring Apple Pencil handwriting canvas, universal Anki (`.apkg` / `.colpkg`) ingestion, offline OPFS media streaming, and goal-driven study planning.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Overview

**PocketSRS** is a modern, high-performance spaced repetition web application built specifically for deep language acquisition (Japanese, Chinese, Korean, and Latin scripts). Combining modern cognitive science with on-device hardware acceleration, PocketSRS delivers an interactive, native-feeling study environment that runs completely offline in any modern browser.

---

## ✨ Key Features

### 🧠 Free Spaced Repetition Scheduler (FSRS-6)
- **Advanced DSR Modeling**: Calculates card Difficulty ($D$), Stability ($S$), and Retrievability ($R$) with the latest 21-parameter weight vector.
- **Intraday Learning Steps**: Granular 1-minute and 10-minute intraday steps with configurable lapse steps.
- **Twin Card Generation**: Automatically generates bidirectional twin cards (Recognition: Character → Meaning; Production: Meaning → Character) with sibling card burying across logical day rollovers.
- **On-Device Wasm Optimizer**: Calibrates personal FSRS weights from local review logs via a dedicated Web Worker without transmitting data to external servers.

### ✍️ Apple Pencil & Stylus Handwriting Scratchpad
- **Hardware-Accelerated Canvas**: Low-latency `<canvas>` with pressure sensitivity, stroke smoothing, and palm rejection for Apple Pencil and capacitive styluses.
- **SVG Ghost Guides & Stroke Animations**: Faded kanji/hanzi stroke outlines assisting stroke order memory.
- **Multi-Character Pill Bar**: Automatically fragments multi-character terms (e.g., `食べる` → `[食]` `[べ]` `[る]`) into single-character tracing canvases with keyboard and touch navigation.
- **In-Session Writing Toggle**: Quickly toggle writing mode on or off (`W` shortcut) with sticky action footers designed for mobile (`100dvh`).

### 📥 Universal Ingestion Engine
- **Unified Import Hub**: Single-modal workflow supporting 4 distinct formats:
  - **CSV / TSV**: RFC 4180-compliant parser extracting `character`, `reading`, `meaning`, `exampleSentence`, `notes`, `tags`, `book`, and `chapter`.
  - **JSON Datasets**: Supports array structures and dictionary formats (e.g., Minna no Nihongo chapters).
  - **Markdown Quick-Paste**: Syntax-driven fast paste format (`Word(reading) :: Meaning // Example #tags`).
  - **Universal Anki Ingestion**: Direct support for Anki `.apkg` and `.colpkg` archives (anki2, anki21, and Zstandard anki21b SQLite formats).
- **Streaming OPFS Media**: Streams audio clips and images directly into the browser's Origin Private File System (OPFS) with SHA-256 content addressing, avoiding RAM exhaustion on multi-gigabyte collections.
- **Interactive Field Mapper**: Auto-detects note models and lets users visually map source fields to PocketSRS slots with live card previews.

### 📚 Hierarchical Curriculum Structure
- **Book → Chapter → Deck Organization**: Model complete textbooks and courses (e.g., *Minna no Nihongo 1 & 2*, *Genki*, *Tobar*, *HSK*).
- **Recursive Due Counts**: Displays real-time aggregate new, learning, and review counts up the entire deck tree hierarchy.
- **Compound Database Indices**: IndexedDB compound indices (`[deckId+due]`, `[state+due]`, `[character+reading]`) powered by Dexie for instant queries across 50,000+ cards.

### 🎯 Goal-Driven Study Planner
- **Pacing Engine**: Set an exam or target deadline with custom buffer review days.
- **Dynamic Daily Targets**: Mathematically derives daily new cards and estimated review volume to guarantee textbook mastery by exam day.

### 🔄 Sync, PWA, & Hardware Integrations
- **Peer-to-Peer & Cloud Sync**: Event-sourced sync logs with soft-delete tombstones for conflict-free multi-device synchronization.
- **Screen Wake Lock**: Prevents screen sleep during active study sessions.
- **Media Session Keep-Alive**: Background audio integration ensuring persistent playback and system media controls.
- **Full PWA Offline Support**: Precached assets and service workers for instant offline launches on iOS and Android homescreens.

---

## 🛠️ Tech Stack

| Category | Technologies |
| :--- | :--- |
| **Frontend Framework** | [React 19](https://react.dev/), [TypeScript 5.8](https://www.typescriptlang.org/) |
| **Build & Tooling** | [Vite 6.4](https://vitejs.dev/), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) |
| **Styling & UI** | [Tailwind CSS 3.4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/) |
| **Scheduling Algorithm** | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS-6) |
| **Local Database** | [Dexie.js 4](https://dexie.org/) (IndexedDB) with reactive hooks |
| **Archive & SQLite Parsing** | [sql.js](https://sql.js.org/) (Wasm), [fflate](https://github.com/101arrowz/fflate), [fzstd](https://github.com/101arrowz/fzstd), [protobufjs](https://protobufjs.github.io/protobuf.js/) |
| **Sanitization & Security** | [DOMPurify](https://github.com/cure53/DOMPurify) |
| **Testing** | [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/) |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or later)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ValentinoTan/PocketSRS.git
   cd PocketSRS
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

4. **Build for production:**
   ```bash
   npm run build
   ```

---

## ⌨️ Study Session Keyboard Shortcuts

| Shortcut | Action |
| :---: | :--- |
| <kbd>Space</kbd> / <kbd>Enter</kbd> | Flip Card / Show Answer |
| <kbd>1</kbd> | Rate **Again** (Reset interval / lapse) |
| <kbd>2</kbd> | Rate **Hard** (Sub-optimal recall) |
| <kbd>3</kbd> | Rate **Good** (Standard optimal recall) |
| <kbd>4</kbd> | Rate **Easy** (Effortless recall) |
| <kbd>W</kbd> | Toggle **Writing Mode** (Apple Pencil Scratchpad) |
| <kbd>E</kbd> | Quick-Edit Note Modal |
| <kbd>F</kbd> | Toggle Card Flag |
| <kbd>Z</kbd> | Revocable **Undo** Last Review |
| <kbd>R</kbd> | Play Audio Pronunciation (Web Speech TTS) |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Developed with ❤️ by **[Valentino Tan](https://github.com/ValentinoTan)**.
