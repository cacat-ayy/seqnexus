/**
 * The ten themes: five light, five dark. The colours here draw the theme
 * picker's preview cards only; the themes themselves are the token blocks in
 * App.css, selected by the data-theme attribute on .app-root.
 */

export type ThemeName =
  | 'light' | 'dark' | 'midnight' | 'solarized' | 'nature'
  | 'rose' | 'lavender' | 'dracula' | 'nord' | 'catppuccin'

export interface ThemeInfo {
  id: ThemeName
  label: string
  group: 'light' | 'dark'
  bg: string      // card background
  outer: string   // outer preview bg
  accent: string  // accent bar
  text: string    // text line
  muted: string   // muted line
}

export const THEMES: ThemeInfo[] = [
  { id: 'light',      label: 'Light',      group: 'light', bg: '#ffffff', outer: '#f0f2f5', accent: '#6366f1', text: '#1e293b', muted: '#94a3b8' },
  { id: 'solarized',  label: 'Solarized',  group: 'light', bg: '#fdf6e3', outer: '#eee8d5', accent: '#268bd2', text: '#002b36', muted: '#93a1a1' },
  { id: 'nature',     label: 'Nature',     group: 'light', bg: '#f8fcf8', outer: '#ecf5ec', accent: '#16a34a', text: '#14532d', muted: '#86a892' },
  { id: 'rose',       label: 'Rosé',       group: 'light', bg: '#fffbfc', outer: '#f8f0f3', accent: '#e11d48', text: '#1c1017', muted: '#a8929c' },
  { id: 'lavender',   label: 'Lavender',   group: 'light', bg: '#faf8ff', outer: '#f0ecf9', accent: '#7c3aed', text: '#2e1065', muted: '#a393bf' },
  { id: 'dark',       label: 'Dark',       group: 'dark',  bg: '#1e293b', outer: '#0f172a', accent: '#818cf8', text: '#f1f5f9', muted: '#64748b' },
  { id: 'midnight',   label: 'Midnight',   group: 'dark',  bg: '#0c1222', outer: '#020617', accent: '#38bdf8', text: '#e0f2fe', muted: '#38bdf8' },
  { id: 'dracula',    label: 'Dracula',    group: 'dark',  bg: '#282a36', outer: '#1e1f29', accent: '#bd93f9', text: '#f8f8f2', muted: '#6272a4' },
  { id: 'nord',       label: 'Nord',       group: 'dark',  bg: '#2e3440', outer: '#242933', accent: '#88c0d0', text: '#eceff4', muted: '#7b88a1' },
  { id: 'catppuccin', label: 'Catppuccin', group: 'dark',  bg: '#1e1e2e', outer: '#11111b', accent: '#cba6f7', text: '#cdd6f4', muted: '#6c7086' },
]
