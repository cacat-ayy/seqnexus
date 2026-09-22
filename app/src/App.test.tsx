import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the app root', () => {
    render(<App />)
    const root = document.querySelector('.app-root')
    expect(root).toBeTruthy()
  })

  it('renders the toolbar', () => {
    render(<App />)
    const toolbar = document.querySelector('.toolbar')
    expect(toolbar).toBeTruthy()
  })
})
