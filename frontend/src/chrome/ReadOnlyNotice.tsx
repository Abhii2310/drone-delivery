/** Below 768px the console degrades truthfully: monitoring only, and it says so. */
export default function ReadOnlyNotice() {
  return (
    <div
      className="fixed bottom-0 left-0 z-40 hidden max-[767px]:block"
      style={{ right: 0, background: 'var(--panel-solid)', borderTop: '1px solid var(--rule)', padding: '8px 16px' }}
    >
      <span className="t-body" style={{ color: 'var(--graticule)' }}>
        Approvals require a workstation.
      </span>
    </div>
  )
}
