/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        oled: {
          bg: '#000000',
          card: '#0a0a0a',
          border: '#1f1f1f',
        }
      }
    },
  },
  plugins: [],
}
