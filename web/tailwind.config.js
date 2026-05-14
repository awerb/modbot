/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: "#1a4d3a",
        wa: {
          header: "#075E54",
          bg: "#ECE5DD",
          out: "#DCF8C6",
          accent: "#25D366",
          deep: "#128C7E",
        },
      },
    },
  },
  plugins: [],
};
