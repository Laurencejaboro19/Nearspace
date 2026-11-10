/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: {
          950: "#05070d",
          900: "#0a0f1a",
          850: "#0f1626",
          800: "#141d31",
          700: "#1d2942",
          600: "#2a3a5c",
          500: "#3d5280",
        },
        accent: { DEFAULT: "#22d3ee", soft: "#67e8f9", deep: "#0891b2" },
        pass: "#a3e635",
        warn: "#fbbf24",
        fail: "#fb7185",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
        drift: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        shimmer: { "0%": { backgroundPosition: "-500px 0" }, "100%": { backgroundPosition: "500px 0" } },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.2,.7,.3,1) both",
        drift: "drift 7s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
