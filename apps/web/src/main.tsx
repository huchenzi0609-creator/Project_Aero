/**
 * @aero/web —— WIP 占位（M3 设计系统 Agent 将替换全部 src/，见 docs/design.md §3、§8）。
 */
import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>纸面海战 · Project Aero</h1>
      <p>开发中（M3 设计系统与页面待实现）……</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
