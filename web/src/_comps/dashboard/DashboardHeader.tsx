"use client"

import { Moon, Search, Sun } from "lucide-react"
import { useTheme } from "@/_comps/providers/ThemeProvider"
import { Logo } from "./Logo"

type DashboardHeaderProps = {
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
  onLogout?: () => void
}

export function DashboardHeader({
  query,
  onQueryChange,
  onSubmit,
  onBack,
  onLogout,
}: DashboardHeaderProps) {
  const { theme, toggleTheme } = useTheme()
  const themeLabel = theme === "dark" ? "Day" : "Night"

  return (
    <header className="dashboard-header">
      <button
        type="button"
        onClick={onBack}
        title="Back to search"
        aria-label="Back to search"
        className="dashboard-logo-button"
      >
        <Logo />
      </button>
      <div className="dashboard-header-search">
        <div className="dashboard-search">
          <span className="dashboard-youtube-mark" aria-hidden="true">
            <svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true">
              <polygon points="0,0 9,5.5 0,11" fill="#F2ECD4" />
            </svg>
          </span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit()
            }}
            placeholder="Search YouTube or paste a link..."
            className="dashboard-search-input"
          />
          <button type="button" onClick={onSubmit} aria-label="Search" className="dashboard-search-button">
            <Search size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        title={`Switch to ${themeLabel.toLowerCase()} theme`}
        aria-label={`Switch to ${themeLabel.toLowerCase()} theme`}
        className="dashboard-theme-toggle"
      >
        {theme === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        <span>{themeLabel}</span>
      </button>
      {onLogout && (
        <button type="button" onClick={onLogout} title="Logout" aria-label="Logout" className="dashboard-language">
          Logout
        </button>
      )}
    </header>
  )
}
