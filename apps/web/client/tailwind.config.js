/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                theme: {
                    primary: 'var(--bg-primary)',
                    secondary: 'var(--bg-secondary)',
                    tertiary: 'var(--bg-tertiary)',
                    input: 'var(--bg-input)',
                },
                'theme-border': {
                    primary: 'var(--border-primary)',
                    secondary: 'var(--border-secondary)',
                },
                'theme-text': {
                    primary: 'var(--text-primary)',
                    secondary: 'var(--text-secondary)',
                    muted: 'var(--text-muted)',
                    inverse: 'var(--text-inverse)',
                },
                'theme-accent': {
                    primary: 'var(--accent-primary)',
                    secondary: 'var(--accent-secondary)',
                    danger: 'var(--accent-danger)',
                    warning: 'var(--accent-warning)',
                    purple: 'var(--accent-purple)',
                },
            },
        },
    },
    plugins: [],
}
