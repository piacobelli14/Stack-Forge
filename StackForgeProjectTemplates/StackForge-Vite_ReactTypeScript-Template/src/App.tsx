import React from 'react'
import logo from './assets/StackForgeLogo.png'

export default function App() {
  return (
    <div className="template-wrapper">
      <img src={logo} />
      <h1>Stack Forge with Vite + React TypeScript</h1>
      <p>
        This is a single page built with Vite and React TypeScript by the Stack Forge team
        for you to get started!
      </p>
      <a
        href="https://stackforgeengine.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        https://stackforgeengine.com
      </a>
    </div>
  )
}
