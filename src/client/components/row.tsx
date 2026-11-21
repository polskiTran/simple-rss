export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <dt className="row-label">{label}</dt>
      <dd className="row-value">{value}</dd>
    </div>
  )
}
