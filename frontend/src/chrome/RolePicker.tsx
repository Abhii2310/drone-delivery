import { setViewer, type Viewer } from '../lib/ws'
import { useStore, type Role } from '../store'

const VIEWERS: Record<Role, Viewer> = {
  GOVERNMENT: { role: 'GOVERNMENT' },
  OPERATOR: { role: 'OPERATOR', operator_id: 'OP-MEDX' },
  HUB_ENGINEER: { role: 'HUB_ENGINEER', hub_id: 'HUB-MED' },
  CUSTOMER: { role: 'CUSTOMER' },
}

const LABEL: Record<Role, string> = {
  GOVERNMENT: 'Government',
  OPERATOR: 'Operator · OP-MEDX',
  HUB_ENGINEER: 'Hub engineer · HUB-MED',
  CUSTOMER: 'Customer',
}

export default function RolePicker() {
  const role = useStore((s) => s.role)
  const setRole = useStore((s) => s.setRole)

  return (
    <label className="flex items-center gap-2">
      <span className="t-label" style={{ color: 'var(--graticule)' }}>
        ROLE
      </span>
      <select
        value={role}
        onChange={(e) => {
          const next = e.target.value as Role
          setRole(next)
          setViewer(VIEWERS[next]) // reconnects; the server refilters everything
        }}
        style={{
          background: 'var(--panel-solid)',
          color: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r-sm)',
          padding: '3px 6px',
          font: '500 11px/1.2 var(--font-ui)',
          letterSpacing: '0.04em',
        }}
      >
        {(Object.keys(VIEWERS) as Role[]).map((r) => (
          <option key={r} value={r}>
            {LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  )
}
