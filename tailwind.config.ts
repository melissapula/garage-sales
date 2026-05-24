import type { Config } from 'tailwindcss';

export default <Partial<Config>>{
    content: [
        './components/**/*.{vue,js,ts}',
        './layouts/**/*.vue',
        './pages/**/*.vue',
        './app.vue',
        './app/**/*.{vue,js,ts}',
    ],
    theme: {
        extend: {
            colors: {
                // Primary — vibrant orange (sunshine, weekend energy)
                brand: {
                    DEFAULT: '#F97316',
                    50: '#FFF7ED',
                    100: '#FFEDD5',
                    200: '#FED7AA',
                    300: '#FDBA74',
                    400: '#FB923C',
                    500: '#F97316',
                    600: '#EA580C',
                    700: '#C2410C',
                    800: '#9A3412',
                    900: '#7C2D12',
                },
                // Secondary — sky blue
                sky: {
                    DEFAULT: '#0EA5E9',
                    50: '#F0F9FF',
                    100: '#E0F2FE',
                    500: '#0EA5E9',
                    600: '#0284C7',
                    700: '#0369A1',
                },
                // Pin status colors
                pin: {
                    active: '#22C55E',
                    upcoming: '#EAB308',
                },
                // Warm cream background
                cream: '#FFFBEB',
            },
            fontFamily: {
                display: ['"Playfair Display"', 'serif'],
                sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
            },
        },
    },
};
