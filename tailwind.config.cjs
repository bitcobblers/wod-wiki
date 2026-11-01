/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    
    './playground/**/*.{js,ts,jsx,tsx}',
  ],
  prefix: "",
  theme: {
    extend: {
      screens: {
        "2xl": "1520px",
        "3xl": "1800px",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Metric tokens — keyed to CSS variables */
        metric: {
          time:       "hsl(var(--metric-time))",
          rep:        "hsl(var(--metric-rep))",
          effort:     "hsl(var(--metric-effort))",
          rounds:     "hsl(var(--metric-rounds))",
          distance:   "hsl(var(--metric-distance))",
          resistance: "hsl(var(--metric-resistance))",
          action:     "hsl(var(--metric-action))",
          equipment:  "hsl(var(--metric-equipment))",
        },
        /* Semantic state tokens */
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        /* Brand tokens aligned to Mineral/Arctic primary (slate blue) */
        brand: {
          DEFAULT: "#5980a8",       /* Mineral slate blue */
          light: "#d6e4f0",         /* tinted surface */
          deep: "#3d5c7a",          /* dark variant for text */
        },
      },
      borderRadius: {
        pill: "9999px",             /* full-pill — signature Mintlify shape */
        "2xl": "1.5rem",            /* 24px — featured cards */
        xl: "1.25rem",              /* 20px */
        lg: "var(--radius)",        /* 16px — standard cards */
        md: "calc(var(--radius) - 2px)",
        sm: "4px",                  /* inline code, small tags */
      },
      fontFamily: {
        sans: ["Inter", "Inter Fallback", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        "display": "-0.08em",   /* hero headlines — tight compression */
        "heading": "-0.05em",   /* section headings */
        "subhead": "-0.015em",  /* sub-headings */
        "label": "0.065em",     /* uppercase labels */
        "mono": "0.06em",       /* mono technical tags */
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
