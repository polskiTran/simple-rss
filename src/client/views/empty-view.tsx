export function EmptyView({ note }: { readonly note: string }) {
  return (
    <div className="view measure">
      <p className="empty-note">{note}</p>
    </div>
  )
}
