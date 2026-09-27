export function EmptyView({ note }: { readonly note: string }) {
  return (
    <div className="view">
      <p className="note">{note}</p>
    </div>
  )
}
