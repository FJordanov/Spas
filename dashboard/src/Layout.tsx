import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Alert, MapStyle, UserRole } from './AlertsMap'

type Tab = 'Alerts' | 'Account' | 'Settings' | 'Developer tools'

type LayoutProps = {
  email: string
  role: UserRole | null
  showTestAlerts: boolean
  onShowTestAlertsChange: (show: boolean) => void
  alertCount: number
  testAlertCount: number
  alerts: Alert[]
  mapStyle: MapStyle
  onMapStyleChange: (style: MapStyle) => void
  onSignOut: () => void
  alertsContent: (isVisible: boolean) => ReactNode
}

const TABS: Tab[] = ['Alerts', 'Account', 'Settings', 'Developer tools']

export default function Layout({
  email,
  role,
  showTestAlerts,
  onShowTestAlertsChange,
  alertCount,
  testAlertCount,
  alerts,
  mapStyle,
  onMapStyleChange,
  onSignOut,
  alertsContent,
}: LayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Alerts')
  const isDeveloper = role === 'admin' || role === 'developer'
  const tabs = TABS.filter((tab) => tab !== 'Developer tools' || isDeveloper)
  const deviceIds = [...new Set(alerts.map((alert) => alert.device_id).filter(Boolean))]

  return (
    <div className="staff-layout">
      <style>{`
        #root {
          width: 100%;
          max-width: none;
          min-height: 100vh;
          margin: 0;
          border: 0;
          text-align: left;
        }
        .staff-layout {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          min-height: 100vh;
          overflow-x: hidden;
          background: #f4f2ee;
          color: #202321;
          font-family: system-ui, sans-serif;
          text-align: left;
        }
        .staff-sidebar {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 24px 16px;
          border-right: 1px solid #dedbd5;
          background: #fff;
        }
        .staff-nav { display: grid; gap: 8px; }
        .staff-content { min-width: 0; overflow-x: hidden; padding: 24px; }
        .staff-bottom { display: none; }
        .staff-card {
          max-width: 720px;
          padding: 24px;
          border: 1px solid #dedbd5;
          border-radius: 12px;
          background: #fff;
        }
        .staff-option-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
        .staff-option {
          min-width: 120px;
          min-height: 44px;
          padding: 10px 16px;
          border: 1px solid #dedbd5;
          border-radius: 8px;
          background: #fff;
          color: #202321;
          cursor: pointer;
        }
        .staff-option[aria-pressed="true"] { border: 2px solid #202321; }
        .staff-device-list { display: grid; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
        .staff-nav-button {
          min-height: 48px;
          padding: 12px 16px;
          border: 0;
          border-left: 2px solid transparent;
          background: transparent;
          color: #626863;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .staff-nav-button[aria-current="page"] {
          border-left-color: #202321;
          color: #202321;
          font-weight: 600;
        }
        .staff-app-name { margin: 0; color: #202321; font-size: 20px; font-weight: 700; }
        .staff-heading { margin: 0 0 24px; color: #202321; font-size: 24px; }
        .staff-muted { color: #626863; }
        .staff-sign-out {
          min-height: 44px;
          margin-top: 24px;
          padding: 10px 16px;
          border: 0;
          border-radius: 8px;
          background: #28734b;
          color: #fff;
          font: inherit;
          font-weight: 650;
          cursor: pointer;
        }
        @media (max-width: 768px) {
          .staff-layout { display: block; padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
          .staff-sidebar { display: none; }
          .staff-content { padding: 16px; }
          .staff-bottom {
            position: fixed;
            z-index: 2000;
            right: 0;
            bottom: 0;
            left: 0;
            display: flex;
            min-height: 64px;
            box-sizing: border-box;
            justify-content: space-around;
            gap: 4px;
            padding: 8px 8px max(8px, env(safe-area-inset-bottom));
            border-top: 1px solid #dedbd5;
            background: #fff;
          }
          .staff-nav-button {
            display: flex;
            flex: 1;
            min-width: 0;
            min-height: 48px;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: 6px 4px;
            border: 0;
            border-top: 2px solid transparent;
            font-size: 12px;
            text-align: center;
          }
          .staff-nav-button[aria-current="page"] {
            border-top-color: #202321;
            border-left-color: transparent;
          }
          .staff-card { padding: 16px; }
        }
      `}</style>
      <aside className="staff-sidebar">
        <p className="staff-app-name">Spas Staff</p>
        <nav className="staff-nav" aria-label="Main navigation">
          {tabs.map((tab) => (
            <button
              key={tab}
              className="staff-nav-button"
              type="button"
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => setActiveTab(tab)}
            >
              <span aria-hidden="true">{tab === 'Alerts' ? '⌖' : tab === 'Account' ? '◉' : '⚙'}</span>
              <span>{tab}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="staff-content">
        <div style={{ display: activeTab === 'Alerts' ? 'block' : 'none' }}>
          {alertsContent(activeTab === 'Alerts')}
        </div>
        {activeTab === 'Account' && (
          <section className="staff-card">
            <h1 className="staff-heading">Account</h1>
            <p>Signed in as {email}</p>
            <p className="staff-muted" style={{ marginTop: 8 }}>Role: {role ?? 'unknown'}</p>
            <button className="staff-sign-out" type="button" onClick={onSignOut}>Sign out</button>
          </section>
        )}
        {activeTab === 'Settings' && (
          <section className="staff-card">
            <h1 className="staff-heading">Settings</h1>
            <h2 style={{ margin: 0, color: '#202321', fontSize: 18 }}>Map style</h2>
            <div className="staff-option-row">
              {(['street', 'satellite'] as const).map((style) => (
                <button
                  key={style}
                  className="staff-option"
                  type="button"
                  aria-pressed={mapStyle === style}
                  onClick={() => onMapStyleChange(style)}
                >
                  {style === 'street' ? 'Street' : 'Satellite'}
                </button>
              ))}
            </div>
          </section>
        )}
        {activeTab === 'Developer tools' && isDeveloper && (
          <section className="staff-card">
            <h1 className="staff-heading">Developer tools</h1>
            <p style={{ marginBottom: 16 }}>Unique device IDs: {deviceIds.length}</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={showTestAlerts}
                onChange={(event) => onShowTestAlertsChange(event.target.checked)}
              />
              Show test alerts
            </label>
            <p style={{ marginTop: 16 }}>Loaded alerts: {alertCount}</p>
            <p style={{ marginTop: 8 }}>Tests: {testAlertCount}</p>
            <p className="staff-muted" style={{ marginTop: 8 }}>Role: {role}</p>
            <h2 style={{ margin: '24px 0 0', color: '#202321', fontSize: 18 }}>Device IDs</h2>
            {deviceIds.length ? (
              <ul className="staff-device-list">
                {deviceIds.map((deviceId) => <li key={deviceId}>{deviceId}</li>)}
              </ul>
            ) : (
              <p className="staff-muted" style={{ marginTop: 12 }}>No device IDs loaded.</p>
            )}
          </section>
        )}
      </main>
      <nav className="staff-bottom" aria-label="Main navigation">
        {tabs.map((tab) => (
          <button
            key={tab}
            className="staff-nav-button"
            type="button"
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => setActiveTab(tab)}
          >
            <span aria-hidden="true">{tab === 'Alerts' ? '⌖' : tab === 'Account' ? '◉' : '⚙'}</span>
            <span>{tab}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
